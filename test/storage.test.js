import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, createInitialState, createPlayer, validateState,
  load, save, exportJson, importJson,
} from '../js/storage.js';
import { stageOf, displayStageOf } from '../js/core/player.js';
import { totalExpForLevel } from '../js/core/exp.js';

/** localStorage の偽物 */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function failingStorage() {
  return {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
}

const NOW = '2026-07-26T10:00:00.000Z';
const player = () => createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });

test('createInitialState はプレイヤー0人の状態', () => {
  const s = createInitialState();
  // 進化の意味論変更（2026-07-28）に伴う移行のやり直し（別キーの印→state.version自身）で
  // SCHEMA_VERSION を 1→2 に上げたため、新規インストールは最初から version 2 を持つ
  assert.equal(s.version, 2);
  assert.deepEqual(s.players, []);
  assert.equal(s.activePlayerId, null);
});

test('createPlayer は御三家1体を持ったプレイヤーを作る', () => {
  const p = player();
  assert.equal(p.name, 'たろう');
  assert.deepEqual(p.records, []);
  assert.deepEqual(p.pending, []);
  assert.equal(p.activeCharId, 'hinoko');
  assert.deepEqual(p.chars, [
    { charId: 'hinoko', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] },
  ]);
  assert.equal(p.settings.approvalEnabled, false);
  assert.equal(p.settings.passwordHash, null);
});

test('validateState: 正しい状態は ok', () => {
  const s = createInitialState();
  s.players.push(player());
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: version 不一致を弾く', () => {
  const s = createInitialState();
  // SCHEMA_VERSION が 2 に上がったので、不一致を作るには 2 以外の値にする必要がある。
  // ここでは移行前(v8)のバージョンである 1 を直接 validateState に渡す形にする。
  // 移行は validateState の前に行う設計なので、移行前の生の値が validateState に
  // そのまま渡ることは正規の経路では起きない（load/importJson が先に移行する）が、
  // validateState 単体としては version==SCHEMA_VERSION 以外を弾く、という契約を固定する
  s.version = 1;
  const r = validateState(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('version')));
});

test('validateState: players が配列でなければ弾く', () => {
  assert.equal(validateState({ version: 1, players: 'ng', activePlayerId: null }).ok, false);
});

test('validateState: 実在しない日付を弾く', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({ id: 'r1', date: '2026-02-30', mode: 'no', count: 5, createdAt: NOW });
  s.players.push(p);
  s.activePlayerId = 'p1';
  const r = validateState(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('date')));
});

test('validateState: モードが no/one 以外を弾く', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({ id: 'r1', date: '2026-07-26', mode: 'two', count: 5, createdAt: NOW });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(validateState(s).ok, false);
});

test('validateState: 回数が範囲外（0・10000・小数）を弾く', () => {
  for (const count of [0, 10000, 1.5]) {
    const s = createInitialState();
    const p = player();
    p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count, createdAt: NOW });
    s.players.push(p);
    s.activePlayerId = 'p1';
    assert.equal(validateState(s).ok, false, `count=${count} は不正のはず`);
  }
});

test('validateState: createdAt が ISO タイムスタンプでない記録を弾く', () => {
  for (const bad of ['2026-07-26', 'not-a-date', '<img src=x onerror=alert(1)>', '', '2026-07-26T10:00:00']) {
    const s = createInitialState();
    const p = player();
    p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: bad });
    s.players.push(p);
    s.activePlayerId = 'p1';
    const r = validateState(s);
    assert.equal(r.ok, false, `createdAt=${JSON.stringify(bad)} は不正のはず`);
    assert.ok(r.errors.some((e) => e.includes('createdAt')));
  }
});

test('validateState: 未知のキャラIDを弾く', () => {
  const s = createInitialState();
  const p = player();
  p.chars.push({ charId: 'nazono', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(validateState(s).ok, false);
});

test('validateState: activeCharId が手持ちにない状態を弾く', () => {
  const s = createInitialState();
  const p = player();
  p.activeCharId = 'kagero';
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(validateState(s).ok, false);
});

test('save と load で往復できる', () => {
  const st = fakeStorage();
  const s = createInitialState();
  s.players.push(player());
  s.activePlayerId = 'p1';

  assert.deepEqual(save(st, s), { ok: true, error: null });
  const loaded = load(st);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.state, s);
});

test('保存データがなければ初期状態を返す', () => {
  const loaded = load(fakeStorage());
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state, createInitialState());
});

test('壊れたJSONは初期状態で起動し、破損データを退避する', () => {
  const st = fakeStorage({ [STORAGE_KEY]: '{kowareteiru' });
  const loaded = load(st);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.state, createInitialState());
  assert.equal(st.data[`${STORAGE_KEY}.broken`], '{kowareteiru');
});

test('スキーマ不一致のデータも退避して初期状態で起動する', () => {
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ version: 99 }) });
  const loaded = load(st);
  assert.equal(loaded.recovered, true);
  assert.ok(st.data[`${STORAGE_KEY}.broken`]);
});

test('保存に失敗したらエラーを返し、例外を投げない', () => {
  const r = save(failingStorage(), createInitialState());
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('Quota'));
});

test('exportJson と importJson で往復して同一になる', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 12, createdAt: NOW });
  s.players.push(p);
  s.activePlayerId = 'p1';

  const back = importJson(exportJson(s));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state, s);
});

test('importJson は壊れたJSONを拒否する', () => {
  const r = importJson('{kowareteiru');
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.ok(r.errors.length > 0);
});

test('importJson はスキーマ不一致を拒否する', () => {
  const r = importJson(JSON.stringify({ version: 1, players: [{ id: 'x' }], activePlayerId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
});

// --- レビュー指摘の Critical 不具合の再発防止テスト ---

/** getItem は固定の壊れたペイロードを返し、setItem は常に例外を投げる偽物 */
function failingQuarantineStorage(brokenRaw) {
  return {
    getItem: (k) => (k === STORAGE_KEY ? brokenRaw : null),
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
}

test('validateState: chars 配列に null が含まれても例外を投げず不正として弾く', () => {
  const s = createInitialState();
  const p = player();
  p.chars = [null];
  s.players.push(p);
  s.activePlayerId = 'p1';

  let r;
  assert.doesNotThrow(() => { r = validateState(s); });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('importJson: chars に null が含まれるデータを例外を投げず拒否する', () => {
  const s = createInitialState();
  const p = player();
  p.chars = [null];
  s.players.push(p);
  s.activePlayerId = 'p1';

  let r;
  assert.doesNotThrow(() => { r = importJson(JSON.stringify(s)); });
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.ok(r.errors.length > 0);
});

test('load: chars に null を含む壊れたデータでも例外を投げず初期状態で起動する', () => {
  const s = createInitialState();
  const p = player();
  p.chars = [null];
  s.players.push(p);
  s.activePlayerId = 'p1';
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(s) });

  let loaded;
  assert.doesNotThrow(() => { loaded = load(st); });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.state, createInitialState());
});

test('load: 退避の書き込み自体が失敗しても例外を投げず初期状態で起動する', () => {
  const st = failingQuarantineStorage('{kowareteiru');

  let loaded;
  assert.doesNotThrow(() => { loaded = load(st); });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.state, createInitialState());
});

// --- 手で編集したバックアップJSONが入口になるケース ---
// パスワードもあいことばも忘れたときの復旧手段としてJSONの手編集を案内しているため、
// 手で書かれた（＝キーが抜けている・型が違う）状態が正規の入力として入ってくる

/** state を1人ぶん組み立てるヘルパ（players[0] を渡した関数で加工できる） */
function stateWith(mutate) {
  const s = createInitialState();
  const p = player();
  mutate(p);
  s.players.push(p);
  s.activePlayerId = 'p1';
  return s;
}

test('validateState: pendingEffects が無いプレイヤーを弾く（承認画面が展開して落ちるため）', () => {
  const s = stateWith((p) => { delete p.pendingEffects; });
  const r = validateState(s);
  assert.equal(r.ok, false, 'pendingEffects が無い状態は不正のはず');
  assert.ok(r.errors.some((e) => e.includes('pendingEffects')));
});

test('validateState: pendingEffects が配列でない・中身が壊れている場合を弾く', () => {
  const bad = [
    'ng',
    {},
    [null],
    [{ type: 'approved', count: 1 }],                       // exp が無い
    [{ type: 'approved', count: 'いち', exp: 3 }],           // count が数値でない
    [{ type: 'approved', count: 1, exp: Number.NaN }],       // exp が NaN
    [{ type: 1, count: 1, exp: 3 }],                         // type が文字列でない
  ];
  for (const value of bad) {
    const r = validateState(stateWith((p) => { p.pendingEffects = value; }));
    assert.equal(r.ok, false, `pendingEffects=${JSON.stringify(value)} は不正のはず`);
    assert.ok(r.errors.some((e) => e.includes('pendingEffects')));
  }
});

test('validateState: 正しい pendingEffects は通す', () => {
  const s = stateWith((p) => { p.pendingEffects = [{ type: 'approved', count: 2, exp: 54 }]; });
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

// --- 記録の修正機能（仕様 §2.5・§3.1・§3.3）: charId/grantedExp/originalCount/editedAt ---

test('validateState: 新フィールド(charId/grantedExp/originalCount/editedAt)を持たない旧データの記録を不正としない', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: 正しい charId/grantedExp/originalCount/editedAt を持つ新データの記録を受理する', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({
    id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW,
    charId: 'hinoko', grantedExp: 18, originalCount: 8, editedAt: NOW,
  });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: charId が未知のキャラIDなら記録を不正と判定する', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({
    id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW, charId: 'nazono-character',
  });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(validateState(s).ok, false, '未知の charId は不正のはず');
});

test('validateState: grantedExp が非数値なら記録を不正と判定する', () => {
  for (const bad of ['じゅう', Number.NaN, {}, []]) {
    const s = createInitialState();
    const p = player();
    p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW, grantedExp: bad });
    s.players.push(p);
    s.activePlayerId = 'p1';
    const r = validateState(s);
    assert.equal(r.ok, false, `grantedExp=${JSON.stringify(bad)} は不正のはず`);
  }
});

test('validateState: grantedExp が負の数なら記録を不正と判定する', () => {
  const s = createInitialState();
  const p = player();
  p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW, grantedExp: -1 });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(validateState(s).ok, false);
});

test('validateState: originalCount が範囲外（0・10000・小数）なら記録を不正と判定する', () => {
  for (const bad of [0, 10000, 1.5]) {
    const s = createInitialState();
    const p = player();
    p.records.push({ id: 'r1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW, originalCount: bad });
    s.players.push(p);
    s.activePlayerId = 'p1';
    const r = validateState(s);
    assert.equal(r.ok, false, `originalCount=${bad} は不正のはず`);
  }
});

// 仕様§3.3: `{ type: 'edited', exp }` は count を持たない（承認の `{ type: 'approved', count, exp }`
// と違い1件の修正につき1エントリのため count が不要）。既存の validatePendingEffects は
// count を必須にしているため、実装側で count を省略可にする対応が必要になる想定。
test('validateState: pendingEffects の type が edited のとき count が無くても受理する（仕様§3.3）', () => {
  const s = stateWith((p) => { p.pendingEffects = [{ type: 'edited', exp: 30 }]; });
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: pendingEffects の edited は exp が負（EXPが減った）でも受理する', () => {
  const s = stateWith((p) => { p.pendingEffects = [{ type: 'edited', exp: -12 }]; });
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: プレイヤーの createdAt が ISO タイムスタンプでなければ弾く', () => {
  for (const bad of ['2026-07-26', 'kyou', '', undefined, 12345]) {
    const r = validateState(stateWith((p) => { p.createdAt = bad; }));
    assert.equal(r.ok, false, `createdAt=${JSON.stringify(bad)} は不正のはず`);
    assert.ok(r.errors.some((e) => e.includes('createdAt')));
  }
});

test('validateState: settings のパスワード4項目は null か文字列だけ', () => {
  for (const key of ['passwordHash', 'passwordSalt', 'secretQuestion', 'secretAnswerHash']) {
    const r = validateState(stateWith((p) => { p.settings[key] = 123; }));
    assert.equal(r.ok, false, `${key}=123 は不正のはず`);
    assert.ok(r.errors.some((e) => e.includes(key)));
  }
  const okState = stateWith((p) => {
    p.settings.approvalEnabled = true;
    p.settings.passwordHash = 'abc';
    p.settings.passwordSalt = 'def';
    p.settings.secretQuestion = 'すきな たべもの';
    p.settings.secretAnswerHash = 'ghi';
  });
  assert.deepEqual(validateState(okState), { ok: true, errors: [] });
});

test('importJson: pendingEffects の無いバックアップを取り込まない', () => {
  const s = stateWith((p) => { delete p.pendingEffects; });
  const r = importJson(JSON.stringify(s));
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
});

// --- Task 27: lastBackupAt（後方互換が最優先） ---
// 既にこのアプリを使っている家族のバックアップJSON・localStorageには
// lastBackupAt が存在しない。これを必須にすると家族のデータが読み込めなくなるため、
// 「無い」ことは不正としてはいけない

test('validateState: lastBackupAt が無い（既存データ）状態も ok', () => {
  const s = createInitialState();
  delete s.lastBackupAt;
  s.players.push(player());
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: lastBackupAt は null を受理する', () => {
  const s = createInitialState();
  s.lastBackupAt = null;
  s.players.push(player());
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: lastBackupAt は ISO タイムスタンプ文字列を受理する', () => {
  const s = createInitialState();
  s.lastBackupAt = NOW;
  s.players.push(player());
  s.activePlayerId = 'p1';
  assert.deepEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState: lastBackupAt が ISO タイムスタンプでない文字列を弾く', () => {
  for (const bad of ['2026-07-26', 'kyou', '', 12345, true, {}]) {
    const s = createInitialState();
    s.lastBackupAt = bad;
    s.players.push(player());
    s.activePlayerId = 'p1';
    const r = validateState(s);
    assert.equal(r.ok, false, `lastBackupAt=${JSON.stringify(bad)} は不正のはず`);
    assert.ok(r.errors.some((e) => e.includes('lastBackupAt')));
  }
});

test('createInitialState は lastBackupAt を null で持つ', () => {
  assert.equal(createInitialState().lastBackupAt, null);
});

test('importJson: lastBackupAt の無い古いバックアップも読み込める', () => {
  const s = createInitialState();
  delete s.lastBackupAt;
  s.players.push(player());
  s.activePlayerId = 'p1';
  const r = importJson(JSON.stringify(s));
  assert.equal(r.ok, true);
  assert.equal(r.state.lastBackupAt, undefined);
});

test('load: 2回目の破損は .broken.2 に退避し、1回目の .broken は残る', () => {
  const st = fakeStorage({ [STORAGE_KEY]: '{first-broken' });
  load(st);
  assert.equal(st.data[`${STORAGE_KEY}.broken`], '{first-broken');

  st.data[STORAGE_KEY] = '{second-broken';
  load(st);
  assert.equal(st.data[`${STORAGE_KEY}.broken`], '{first-broken');
  assert.equal(st.data[`${STORAGE_KEY}.broken.2`], '{second-broken');
});

// =============================================================================
// G7・G8: 進化の意味論の変更（2026-07-28・安部さんの判断）に伴う移行（グランドファザリング）。
//
// 背景: displayStageOf の定義が「stageOfとevolvedStagesの大きい方」から
// 「evolvedStagesだけ」に変わる（test/evolutionGating.test.js の巻頭コメント参照）。
// この変更をそのまま既存データに適用すると、すでに本番で「控えのキャラの絵が
// 黙って進化後になっている」端末では絵が退化してしまう（＝「一度見せた進化は
// 取り消さない」という既存の約束を破る）。そこで読み込み時に一度だけ、
// 各キャラの evolvedStages に「いまの潜在段階(stageOf)まで」を埋める。
//
// 【2026-07-28 第2回改訂: 移行の一度きり判定を「別キーの印」から「state.version」へ】
// adversarial-reviewer の5回目のレビューで、別キー(liftingmaster.v1.evolutionGate)
// 方式が3件の欠陥を生んでいたことが判明した。
//   1) importJson がゲートを素通しし、移行後の正当なバックアップを復元するたびに
//      控えのキャラが黙って進化する（v9バックアップとv8バックアップを区別できない）
//   2) 「evolvedStages が空のキャラだけ埋める」ため、[1]+潜在2 のような
//      「非空だが潜在段階まで埋まっていない」データは素通りし、絵が2→1に退化する
//   3) 新規インストール1回目は印を書かずに早期returnするため、初回セッション中に
//      条件を満たしたキャラが、開き直した瞬間に黙って実現する
// 対策として、SCHEMA_VERSION を 1→2 に上げ、移行は state.version===1 のときだけ
// 実行し、実行後に version を 2 にする方式に変える。別キーは廃止する。
// これにより version は state 自身の一部として観測可能になり、以下のテストは
// 「内部の一度きりフラグの名前や形を知らずに確かめる」という以前の建前を離れ、
// state.version を直接見て良い（version は load(storage) が返す state の
// 一部であり、実装の詳細ではなく契約の一部になったため）。
//
// 【このテストが実装場所を決め打ちしていない理由】
// 実装がこの移行をどこで行うか（load() 自身の中か、load() が呼ぶ別関数か、
// app.js の起動処理が load() の直後に行うか）は、このテストからは分からないし
// 分からなくてよいように書いている。ここで固定しているのは「load(storage) が
// 返す state の時点で、移行が済んでいること（version===2）」という観測可能な
// 契約だけ。
// G8は「保存→再読み込み」を1往復させることで、移行が2回目以降の読み込みでは
// 起きない（＝控えのキャラが読み込むたびに勝手に進化していく、という新しい
// バグを生まない）ことを確かめる。
// もし実装が app.js の起動処理側で移行を行う設計を選ぶ場合、この2本は
// load() 単体では成立しなくなる可能性がある（そのときは呼び出し先を
// 実際の起動シーケンスに合わせて書き直す必要がある。下の「進め方」の報告で
// 併記する）。
// =============================================================================

/**
 * 潜在段階が stage になるように、控えのキャラ(hinoko)のレベル・実績を組み立てる。
 * version は明示的に 1 に固定する（＝「v8由来のバックアップ」を装う）。
 * createInitialState() は SCHEMA_VERSION が 2 になった今、最初から version:2 を
 * 返すため、v8データを再現するにはここで明示的に version を戻す必要がある。
 */
function benchedHinokoAtStage(stage, evolvedStages) {
  const s = createInitialState();
  s.version = 1;
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'mokumo', now: NOW });
  if (stage >= 2) {
    p.chars.push({
      charId: 'hinoko', nickname: null, exp: totalExpForLevel(50), unlockedAt: NOW, evolvedStages,
    });
    for (let d = 1; d <= 14; d += 1) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      p.records.push({ id: `r${d}`, date, mode: 'no', count: 40, createdAt: `${date}T09:00:00.000Z` });
    }
  } else {
    p.chars.push({
      charId: 'hinoko', nickname: null, exp: totalExpForLevel(20), unlockedAt: NOW, evolvedStages,
    });
    for (let d = 1; d <= 5; d += 1) {
      const date = `2026-07-0${d}`;
      p.records.push({ id: `r${d}`, date, mode: 'no', count: 20, createdAt: `${date}T09:00:00.000Z` });
    }
  }
  s.players.push(p);
  s.activePlayerId = 'p1';
  return s;
}

test('G7 移行: evolvedStagesが空で潜在段階が1のデータ(version:1)を読み込むと、evolvedStagesに1が埋まり絵が退化しない（演出は出ない）。versionも2に上がる', () => {
  const legacy = benchedHinokoAtStage(1, []);
  // version方式への改訂で validateState は version===2 しか通さない設計になったため、
  // 「これは正当なバックアップJSONの形」という前提チェックは移行前の生データには
  // 当てはまらない（移行前のv1データは、移行して初めて正当な状態になる）。
  // ここでの前提は「v8由来のデータである（version:1）」ことだけにする
  assert.equal(legacy.version, 1, '前提: v8由来のバックアップは version 1');

  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const loaded = load(st);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.version, 2, '移行後は version 2 に上がる');

  const hinoko = loaded.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.equal(stageOf(loaded.state.players[0], 'hinoko'), 1, '潜在段階は1のまま（判定用。意味は変えない）');
  assert.deepEqual(hinoko.evolvedStages, [1], '実現段階（evolvedStages）が潜在段階まで埋められる');
  assert.equal(displayStageOf(loaded.state.players[0], 'hinoko'), 1, '絵は退化しない（すでに見えていた姿のまま）');

  // load() 自身の戻り値には「進化した」という演出用の合図（evolvedTo等）が無い。
  // 移行はサイレントなデータ補正であり、switchChar/addRecordのような
  // 「いま進化した」の通知ではないことを、契約の形そのもので確認する
  assert.ok(!('evolvedTo' in loaded), '移行はサイレント。演出のトリガーではない');
});

// G8（2026-07-28 書き直し）: 旧アサーションは誤りだった。
//
// 旧テストは「evolvedStages=[]・潜在1」のデータをまず移行させ（→[1]）、そのあと
// *潜在段階だけ*を2まで手で進めた状態を再読み込みし、「evolvedStagesは[1]のまま
// （絵も1のまま）」を期待していた。これは2回目の読み込みが version 方式でも
// evolutionGate方式でも「migrationを再発火させない」という意味では正しい。
//
// しかし、この形（旧テストの assert）は defect2（安部さんのレポート参照）と
// 見分けがつかない形で「絵も1のまま」を固定してしまっていた。defect2の実体は
// 「evolvedStagesが**空でない**([1])が、その時点の潜在段階(2)までは埋まっていない」
// v8データを**最初に移行するとき**に、旧実装が
// `if (... || c.evolvedStages.length > 0) continue;` で丸ごとスキップし、
// [1,2]に埋めるべきところを[1]のまま素通りさせてしまう、というもの。
// 旧G8は「すでに移行が済んだあとの2回目の読み込み」しかテストしておらず、
// 「[1]+潜在2 を最初に移行する」瞬間そのものを検証していなかったため、
// 実装がdefect2を持っていても持っていなくても同じ結果（[1]のまま）になり、
// テストが欠陥を検出できず、むしろ「絵も1のまま」という誤った期待値として
// 欠陥を正当化してしまっていた。
//
// 正しい期待値: evolvedStages=[1]・潜在2 のv8データ(version:1)を読み込むと、
// [1,2] になり、絵(displayStageOf)は2のまま。1へ退化させてはいけない。
test('G8（書き直し）移行: evolvedStages=[1]・潜在2 のv8データを読み込むと [1,2] になり絵は2のまま（旧テストは[1]のままを期待していたが誤り）', () => {
  const legacy = benchedHinokoAtStage(2, [1]);
  assert.equal(legacy.version, 1, '前提: v8由来のバックアップは version 1');
  assert.equal(stageOf(legacy.players[0], 'hinoko'), 2, '前提: 潜在段階はすでに2（レベル・実績は満たしている）');

  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const loaded = load(st);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.version, 2, '移行後は version 2 に上がる');

  const hinoko = loaded.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [1, 2], '空でない配列でも、潜在段階までの抜けは埋める（縮めない・詰めない）');
  assert.equal(displayStageOf(loaded.state.players[0], 'hinoko'), 2, '絵は2のまま。1へ退化させてはいけない');
});

test('G8b 移行後に新しく潜在段階が上がっても、控えのままなら実現しない（移行は一度きり）', () => {
  // 1回目の読み込み: 潜在段階1のレガシーデータを移行させる
  const legacy = benchedHinokoAtStage(1, []);
  const st1 = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const first = load(st1);
  const hinokoAfterFirst = first.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinokoAfterFirst.evolvedStages, [1], '前提: G7と同じく1回目で移行される');
  assert.equal(first.state.version, 2, '前提: 移行後は version 2');

  // 実際のアプリなら、この後で保存される（persist）。ここではその「保存された状態」を
  // 素直にシミュレートする: 移行後の state（version:2）を、控えのキャラの潜在段階が
  // 2に上がった（さらに練習を重ねてノー40かい・連続14日を達成した）状態に書き換えた
  // うえで、新しいストレージへ保存し、2回目の読み込み（次回の起動）を行う
  const advanced = JSON.parse(JSON.stringify(first.state));
  assert.equal(advanced.version, 2, '前提: このJSONはすでにversion 2（移行済み）');
  const hinokoEntry = advanced.players[0].chars.find((c) => c.charId === 'hinoko');
  hinokoEntry.exp = totalExpForLevel(50);
  advanced.players[0].records = [];
  for (let d = 1; d <= 14; d += 1) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    advanced.players[0].records.push({
      id: `r${d}`, date, mode: 'no', count: 40, createdAt: `${date}T09:00:00.000Z`,
    });
  }
  assert.equal(stageOf(advanced.players[0], 'hinoko'), 2, '前提: 潜在段階は2まで上がった（控えのまま）');

  const st2 = fakeStorage({ [STORAGE_KEY]: JSON.stringify(advanced) });
  const second = load(st2);
  const hinokoAfterSecond = second.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(
    hinokoAfterSecond.evolvedStages,
    [1],
    'version が既に2なので移行は再発火しない。段階2は「控えのまま」なので実現してはいけない'
    + '（もし再発火する実装なら、あらゆる読み込みが控えを進化させてしまい、'
    + 'switchCharでのゲートが完全に無意味になる）',
  );
  assert.equal(displayStageOf(second.state.players[0], 'hinoko'), 1, '絵も1のまま（2に進化して見えてはいけない）');
  assert.equal(second.state.version, 2);
});

// 追加（実装者・2026-07-28、version方式への改訂後も同じ罠がある）:
// 移行結果を保存してから version を書き換える、という順序の回帰網。
//
// ブラウザでの実機確認で見つかった不具合: realizePastEvolutions はメモリ上の state を
// 書き換えるだけで localStorage に書き戻していないのに、「移行済み」を示す
// version:2 だけが即座に書かれていた。そのため 1回目の起動では絵が引き継がれるが、
// 2回目の起動ではディスク上の version が既に2なので移行がスキップされ、
// evolvedStages は空のまま＝**絵が退化して二度と戻らない**。
// 「一度見せた進化は取り消さない」を守るための移行が、移行自身でそれを破っていた。
// G7/G8 は load を1回ずつしか呼ばないためこれを検出できなかった。
test('G7b 移行: 同じストレージから2回起動しても絵が退化しない（保存してから version を書き換える）', () => {
  const legacy = benchedHinokoAtStage(1, []);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });

  const first = load(st);
  const hinokoFirst = first.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinokoFirst.evolvedStages, [1], '1回目で移行される');

  const onDisk = JSON.parse(st.data[STORAGE_KEY]);
  const onDiskHinoko = onDisk.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(onDiskHinoko.evolvedStages, [1], '移行結果がディスクにも書かれている（メモリ上だけで終わらせない）');
  assert.equal(onDisk.version, 2, 'ディスク上の version も2に上がっている');

  const second = load(st);
  const hinokoSecond = second.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinokoSecond.evolvedStages, [1], '2回目の起動でも消えない');
  assert.equal(displayStageOf(second.state.players[0], 'hinoko'), 1, '絵が退化しない');
  assert.equal(second.state.version, 2);
});

test('G7c 移行: 保存に失敗したらディスク上の version は1のまま残り、次の起動でやり直す', () => {
  const legacy = benchedHinokoAtStage(1, []);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const realSetItem = st.setItem;
  // 本体の保存だけ失敗させる（容量超過の端末を模す）
  st.setItem = (k, v) => {
    if (k === STORAGE_KEY) throw new Error('QuotaExceededError');
    realSetItem(k, v);
  };

  const first = load(st);
  assert.equal(first.ok, true, '保存に失敗しても load は throw しないし起動もできる');
  assert.deepEqual(
    first.state.players[0].chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1],
    'メモリ上では移行されているので、この回の表示は正しい',
  );

  // ディスク上は書き換わっていない（setItemが失敗したので、legacyのJSON文字列のまま）。
  // version が1のまま残っているのが、次回やり直せることの直接の証拠
  const onDiskAfterFailure = JSON.parse(st.data[STORAGE_KEY]);
  assert.equal(onDiskAfterFailure.version, 1, '保存が失敗したので、ディスク上の version は1のまま');

  st.setItem = realSetItem; // 容量が空いた（次回の起動）
  const second = load(st);
  assert.deepEqual(
    second.state.players[0].chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1],
    'version が1のままなので、次の起動で移行がやり直される',
  );
  assert.equal(second.state.version, 2);
  assert.deepEqual(
    JSON.parse(st.data[STORAGE_KEY]).players[0].chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1],
    '今度は保存される',
  );
  assert.equal(JSON.parse(st.data[STORAGE_KEY]).version, 2, '今度はディスク上のversionも2に上がる');
});

test('G7d 移行: 新規データ(version:2)は最初から移行対象にならず、保存を待たずに起動できる。以後も控えは実現しない', () => {
  const s = createInitialState(); // version:2（新規インストール）
  s.players.push(player()); // Lv1・記録なし＝潜在段階0。埋めるものは無い
  s.activePlayerId = 'p1';
  const st = fakeStorage();
  save(st, s);

  const first = load(st);
  assert.deepEqual(first.state, s, '何も足さない（save→load の往復が同一のまま）。version:2なので移行そのものが走らない');

  // version が既に2なので、このあと控えのキャラが潜在段階を上げても勝手に実現しない
  // （これは移行の話ではなく、通常の load が控えを自動で進化させないという性質そのもの）
  const advanced = JSON.parse(JSON.stringify(first.state));
  advanced.players[0].chars[0].exp = totalExpForLevel(20);
  advanced.players[0].records = [];
  for (let d = 1; d <= 5; d += 1) {
    const date = `2026-07-0${d}`;
    advanced.players[0].records.push({ id: `r${d}`, date, mode: 'no', count: 20, createdAt: `${date}T09:00:00.000Z` });
  }
  save(st, advanced);

  const second = load(st);
  const c0 = second.state.players[0].chars[0];
  assert.equal(stageOf(second.state.players[0], c0.charId), 1, '前提: 潜在段階は1まで上がった');
  assert.deepEqual(c0.evolvedStages, [], '起動しただけでは実現しない（switchChar のゲートが効き続ける）');
  assert.equal(displayStageOf(second.state.players[0], c0.charId), 0);
  assert.equal(second.state.version, 2);
});

// =============================================================================
// M1〜M7: version方式そのものの回帰網（安部さんの指示・2026-07-28）。
// defect1（importJsonがゲート素通し）・defect2（非空だが潜在段階まで埋まっていない
// 配列を丸ごとスキップ）・defect3（新規インストール1回目は印を書かず早期return）の
// 再発防止を、G7〜G7dとは独立に、それぞれ最小構成で固定する。
// =============================================================================

test('M1 v9で取った正当なバックアップ(version:2)をimportJsonしても、控えのキャラは進化しない（defect1の再発防止）', () => {
  const legacyShapeButV9 = benchedHinokoAtStage(1, []);
  legacyShapeButV9.version = 2; // v9由来の正当なバックアップとして扱う（移行済み・控えは進化しない）
  const r = importJson(JSON.stringify(legacyShapeButV9));
  assert.equal(r.ok, true);
  const hinoko = r.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [], '移行は発火しない。控えは進化しない');
  assert.equal(displayStageOf(r.state.players[0], 'hinoko'), 0);
  assert.equal(r.state.version, 2);
});

test('M2 v8由来のバックアップ(version:1)をimportJsonすると移行され、絵が退化しない', () => {
  const legacy = benchedHinokoAtStage(1, []);
  const r = importJson(JSON.stringify(legacy));
  assert.equal(r.ok, true);
  assert.equal(r.state.version, 2);
  const hinoko = r.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [1]);
  assert.equal(displayStageOf(r.state.players[0], 'hinoko'), 1);
});

test('M3 evolvedStages=[1]・潜在2 のv8データを移行すると [1,2] になり displayStageOf が 2（defect2）', () => {
  const legacy = benchedHinokoAtStage(2, [1]);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const loaded = load(st);
  const hinoko = loaded.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [1, 2]);
  assert.equal(displayStageOf(loaded.state.players[0], 'hinoko'), 2);
});

test('M4 evolvedStages=[2]・潜在0のv8データを移行しても[2]のまま（縮めない）', () => {
  const s = createInitialState();
  s.version = 1;
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'mokumo', now: NOW });
  p.chars.push({ charId: 'hinoko', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [2] });
  s.players.push(p);
  s.activePlayerId = 'p1';
  assert.equal(stageOf(p, 'hinoko'), 0, '前提: 潜在段階は0（記録を消した等で条件から外れた）');

  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(s) });
  const loaded = load(st);
  assert.equal(loaded.ok, true);
  const hinoko = loaded.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [2], '既存の実績を消してはいけない（ラチェット）');
});

test('M5 新規インストール(version:2)は1回目の起動から移行が走らない。初回セッションで控えの潜在段階が上がっても、開き直して実現しない（defect3）', () => {
  const s = createInitialState();
  assert.equal(s.version, 2, '新規は最初からversion 2');
  s.players.push(player());
  s.activePlayerId = 'p1';
  const st = fakeStorage();
  save(st, s);

  const first = load(st);
  assert.deepEqual(first.state, s, '移行が走らないので何も変わらない(save→loadの往復が同一)');

  // 初回セッション中に控えの潜在段階が上がった状態を保存（開き直しをシミュレート）
  const advanced = JSON.parse(JSON.stringify(first.state));
  advanced.players[0].chars[0].exp = totalExpForLevel(20);
  advanced.players[0].records = [];
  for (let d = 1; d <= 5; d += 1) {
    const date = `2026-07-0${d}`;
    advanced.players[0].records.push({ id: `r${d}`, date, mode: 'no', count: 20, createdAt: `${date}T09:00:00.000Z` });
  }
  save(st, advanced);

  const second = load(st);
  const c0 = second.state.players[0].chars[0];
  assert.equal(stageOf(second.state.players[0], c0.charId), 1, '前提: 潜在段階は1まで上がった');
  assert.deepEqual(c0.evolvedStages, [], '開き直しただけでは実現しない（1回目の起動で印を書けなかった旧defect3の再発防止）');
  assert.equal(displayStageOf(second.state.players[0], c0.charId), 0);
});

test('M6 移行のあとloadを何度呼んでも結果が変わらない（冪等）', () => {
  const legacy = benchedHinokoAtStage(2, [1]);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const first = load(st);
  const second = load(st);
  const third = load(st);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(third.state, first.state);
  assert.equal(first.state.version, 2);
});

test('M7 移行時の保存が失敗したらversionが1のまま残り、次回やり直される（何度失敗しても）', () => {
  const legacy = benchedHinokoAtStage(1, []);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const realSetItem = st.setItem;
  let failuresLeft = 2;
  st.setItem = (k, v) => {
    if (k === STORAGE_KEY && failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('QuotaExceededError');
    }
    realSetItem(k, v);
  };

  load(st); // 1回目: 保存失敗
  assert.equal(JSON.parse(st.data[STORAGE_KEY]).version, 1, '1回目: まだ1のまま');
  load(st); // 2回目: 保存失敗
  assert.equal(JSON.parse(st.data[STORAGE_KEY]).version, 1, '2回目: まだ1のまま（何度失敗してもやり直せる）');
  const third = load(st); // 3回目: 保存成功
  assert.equal(JSON.parse(st.data[STORAGE_KEY]).version, 2, '3回目: ようやく2に上がる');
  assert.deepEqual(
    third.state.players[0].chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1],
  );
});
