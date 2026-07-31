import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecord, approvePending, editRecord, deleteRecord, switchChar,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { levelFromExp, totalExpForLevel } from '../js/core/exp.js';

// =============================================================================
// EXPの保存則（キャラのexp == baseExp + Σ そのキャラのgrantedExp）の回帰網。
//
// adversarial-reviewer が発見した2つの欠陥（欠陥1: commitRecordの承認順序依存、
// 欠陥2: legacyLoserCarryの混成）は、どちらも「保存則そのものを検査するテストが
// 1本も無かった」ために359テストが緑のまま見逃していた。ここではその保存則を
// 直接固定する。実装（js/core 配下）は変更していない — 欠陥は直っていないので、
// このファイルの一部（C2〜C5・C7の一部トライアル）は現状のコードに対して
// FAIL する想定（それが目的）。
//
// 「baseExp」は操作系列の**開始時点**で
//   baseExp = そのキャラの exp − そのキャラに紐づく記録のgrantedExp合計
// として固定する（途中では再計算しない）。以後どれだけ操作を重ねても
//   exp == max(0, baseExp + Σ(現在のgrantedExp))
// が成り立つ。これが崩れる＝無からEXPが生まれた／消えた、ということ。
// =============================================================================

const NOW = '2026-07-26T10:00:00.000Z';

const base = (starterId, exp = 0) => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

/** そのキャラの baseExp（exp − Σ grantedExp）を求める。records の現状から計算する */
function baseExpOfChar(player, charId) {
  const granted = player.records
    .filter((r) => r.charId === charId && Number.isFinite(r.grantedExp))
    .reduce((s, r) => s + r.grantedExp, 0);
  const entry = player.chars.find((c) => c.charId === charId);
  if (!entry) return null;
  return entry.exp - granted;
}

/**
 * 保存則（C1）を検査する。baseExp0 は操作系列の開始時点で固定した値。
 *
 * predicted = baseExp0 + Σ(現在のgrantedExp)。
 * predicted < 0 なら「クランプに当たった」と判定し、実際の exp は 0 であることだけを
 * 確認する（クランプは仕様上ありうる・欠陥ではない）。predicted >= 0 なら
 * exp は predicted に厳密に一致しなければならない（1円のズレも許さない）。
 *
 * @returns {{clamped: boolean, expected: number, actual: number}}
 */
function checkConservation(player, charId, baseExp0) {
  const granted = player.records
    .filter((r) => r.charId === charId && Number.isFinite(r.grantedExp))
    .reduce((s, r) => s + r.grantedExp, 0);
  const predicted = baseExp0 + granted;
  const entry = player.chars.find((c) => c.charId === charId);
  const actual = entry ? entry.exp : null;
  if (predicted < 0) return { clamped: true, expected: 0, actual };
  return { clamped: false, expected: predicted, actual };
}

function assertConservation(player, charId, baseExp0, label) {
  const { clamped, expected, actual } = checkConservation(player, charId, baseExp0);
  assert.equal(
    actual,
    expected,
    `${label}: 保存則が破れている charId=${charId} clamped=${clamped} expected=${expected} actual=${actual}`,
  );
}

// -----------------------------------------------------------------------------
// C1: 保存則そのもの。add/approve/edit/delete を混ぜた操作列のあと、各ステップで
// 保存則を検査する。クロスキャラ（育成中でない兄弟）も対象にする
// -----------------------------------------------------------------------------

test('C1 保存則: add→(switch)→add→edit→delete の操作列で、各ステップ後に happa と hinoko の両方で保存則が成り立つ', () => {
  let p = base('happa', 0);
  p.chars.push({ charId: 'hinoko', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  const base0 = { happa: baseExpOfChar(p, 'happa'), hinoko: baseExpOfChar(p, 'hinoko') };
  assert.deepEqual(base0, { happa: 0, hinoko: 0 }, '前提: 操作開始時点のbaseExpは両方0');

  let cur = p;
  const checkBoth = (label) => {
    assertConservation(cur, 'happa', base0.happa, `${label}(happa)`);
    assertConservation(cur, 'hinoko', base0.hinoko, `${label}(hinoko)`);
  };

  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW }).player;
  checkBoth('addRecord happa r1');

  cur = switchChar(cur, 'hinoko').player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'one', date: '2026-07-20', now: NOW }).player;
  checkBoth('addRecord hinoko r2 (同日クロスモード・クロスキャラ)');

  const edited = editRecord(cur, { recordId: 'r1', count: 4, now: NOW });
  cur = edited.player;
  checkBoth('editRecord r1 (8→4、勝敗が反転しうる)');

  const deleted = deleteRecord(cur, { recordId: 'r2', now: NOW });
  cur = deleted.player;
  checkBoth('deleteRecord r2');
});

// -----------------------------------------------------------------------------
// C2: 欠陥1の再現。同日3件（はっぱ・Lv20）を承認する順番を変えても、
// 合計exp・grantedExpは一致するはず（現状は一致しない＝欠陥1）
// -----------------------------------------------------------------------------

test('C2 承認順序不変（欠陥1の再現）: はっぱLv20で同日3件を逆順に承認しても同じexpになる', () => {
  const BASE_EXP = totalExpForLevel(20);

  const buildQueued = () => {
    const p = base('happa', BASE_EXP);
    p.settings.approvalEnabled = true;
    let cur = p;
    cur = addRecord(cur, { id: 'r0', count: 50, mode: 'no', date: '2026-07-20', now: '2026-07-20T09:00:00.000Z' }).player;
    cur = addRecord(cur, { id: 'r1', count: 150, mode: 'no', date: '2026-07-20', now: '2026-07-20T15:00:00.000Z' }).player;
    cur = addRecord(cur, { id: 'r2', count: 200, mode: 'no', date: '2026-07-20', now: '2026-07-20T21:00:00.000Z' }).player;
    return cur;
  };

  const runOrder = (order) => {
    let cur = buildQueued();
    for (const id of order) {
      const found = cur.pending.find((q) => q.id === id);
      cur = approvePending(cur, { pendingId: id, count: found.count, now: NOW }).player;
    }
    return cur;
  };

  const forward = runOrder(['r0', 'r1', 'r2']);
  const reverse = runOrder(['r2', 'r1', 'r0']);

  const sumGranted = (player) => player.records.reduce((s, r) => s + (r.grantedExp || 0), 0);

  // 新曲線では最初の承認でLv20を越えるため、最終的な付与合計は750
  assert.equal(forward.chars[0].exp, BASE_EXP + 750, '正順の合計exp');
  assert.equal(sumGranted(forward), 750);

  assert.equal(
    reverse.chars[0].exp,
    forward.chars[0].exp,
    '承認の順番を変えても合計expは変わらないはず（親がどのボタンを先に押すかで子供のEXPが変わってはいけない）',
  );
  assert.equal(sumGranted(reverse), sumGranted(forward), '承認の順番を変えてもgrantedExp合計は変わらないはず');
});

// -----------------------------------------------------------------------------
// C3: 欠陥1のあとに全部消すとLv20の基準EXPに戻るはず
// -----------------------------------------------------------------------------

test('C3 削除で基準に戻る（欠陥1の再現）: はっぱLv20で逆順承認したあと3件全部消すと基準に戻る', () => {
  const BASE_EXP = totalExpForLevel(20);
  const p = base('happa', BASE_EXP);
  p.settings.approvalEnabled = true;
  let cur = p;
  cur = addRecord(cur, { id: 'r0', count: 50, mode: 'no', date: '2026-07-20', now: '2026-07-20T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'r1', count: 150, mode: 'no', date: '2026-07-20', now: '2026-07-20T15:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'r2', count: 200, mode: 'no', date: '2026-07-20', now: '2026-07-20T21:00:00.000Z' }).player;

  for (const id of ['r2', 'r1', 'r0']) {
    const found = cur.pending.find((q) => q.id === id);
    cur = approvePending(cur, { pendingId: id, count: found.count, now: NOW }).player;
  }

  for (const id of ['r0', 'r1', 'r2']) {
    cur = deleteRecord(cur, { recordId: id, now: NOW }).player;
  }

  assert.equal(cur.records.length, 0, '前提: 3件とも消えている');
  assert.equal(cur.chars[0].exp, BASE_EXP, '記録を全部消したらLv20の基準EXPに戻る');
});

// -----------------------------------------------------------------------------
// C4: 欠陥2の再現。v10由来のlegacy日（レベル境界をまたぐ）を、同値で「なおす」
// だけではexpが変わらないはず
// -----------------------------------------------------------------------------

test('C4-A legacy同値なおし（欠陥2の再現）: はっぱLv20基準のlegacy日を同値で直すと新ルールへ安定して再配分される', () => {
  const BASE_EXP = totalExpForLevel(20);
  const p = {
    id: 'p1',
    activeCharId: 'happa',
    chars: [{ charId: 'happa', nickname: null, exp: BASE_EXP + 1150, unlockedAt: NOW, evolvedStages: [] }],
    records: [
      {
        id: 'one1', date: '2026-07-28', mode: 'one', count: 350, createdAt: '2026-07-28T09:00:00.000Z',
        charId: 'happa', grantedExp: 700,
      },
      {
        id: 'no1', date: '2026-07-28', mode: 'no', count: 150, createdAt: '2026-07-28T10:00:00.000Z',
        charId: 'happa', grantedExp: 450,
      },
    ],
    pending: [],
    settings: { approvalEnabled: false },
  };

  const { player, result } = editRecord(p, { recordId: 'no1', count: 150, now: NOW });

  // 手計算で確認済み: 新ルールでの正しい再配分は winner=no(900)。
  // before は「実際に配ったぶん」＝保存済みgrantedExp合計(700+450=1150)。
  // after=900。diff=900-1150=-250。正しいexpは BASE_EXP+900
  assert.equal(player.chars[0].exp, BASE_EXP + 900);
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 900);
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 0);
  assert.equal(result.expDelta, -250);
});

test('C4-B legacy同値なおし（欠陥2の再現）: きららが記録中にLv50へ到達するlegacy日を同値で直すと安定する', () => {
  const BASE_EXP = totalExpForLevel(50) - 200;
  const p = {
    id: 'p1',
    activeCharId: 'kirara',
    chars: [{ charId: 'kirara', nickname: null, exp: BASE_EXP + 1550, unlockedAt: NOW, evolvedStages: [] }],
    records: [
      {
        id: 'o1', date: '2026-07-28', mode: 'one', count: 200, createdAt: '2026-07-28T09:00:00.000Z',
        charId: 'kirara', grantedExp: 200,
      },
      {
        id: 'n1', date: '2026-07-28', mode: 'no', count: 300, createdAt: '2026-07-28T10:00:00.000Z',
        charId: 'kirara', grantedExp: 1350,
      },
    ],
    pending: [],
    settings: { approvalEnabled: false },
  };

  const { player, result } = editRecord(p, { recordId: 'o1', count: 200, now: NOW });

  // 手計算で確認済み: before(保存値合計)=200+1350=1550。after(引き直し, winner=no)=900。
  // diff=900-1550=-650。正しいexpはBASE_EXP+900
  assert.equal(player.chars[0].exp, BASE_EXP + 900);
  assert.equal(player.records.find((r) => r.id === 'n1').grantedExp, 900);
  assert.equal(player.records.find((r) => r.id === 'o1').grantedExp, 0);
  assert.equal(result.expDelta, -650);
});

// -----------------------------------------------------------------------------
// C5: 欠陥2の再現。legacy日で「なおす」を繰り返してもgrantedExpが発振しないはず
// -----------------------------------------------------------------------------

test('C5 legacy同値なおしの繰り返し（欠陥2の再現）: きららのLv50境界日を繰り返し直しても値が安定する', () => {
  const BASE_EXP = totalExpForLevel(50) - 200;
  const p = {
    id: 'p1',
    activeCharId: 'kirara',
    chars: [{ charId: 'kirara', nickname: null, exp: BASE_EXP + 1550, unlockedAt: NOW, evolvedStages: [] }],
    records: [
      {
        id: 'o1', date: '2026-07-28', mode: 'one', count: 200, createdAt: '2026-07-28T09:00:00.000Z',
        charId: 'kirara', grantedExp: 200,
      },
      {
        id: 'n1', date: '2026-07-28', mode: 'no', count: 300, createdAt: '2026-07-28T10:00:00.000Z',
        charId: 'kirara', grantedExp: 1350,
      },
    ],
    pending: [],
    settings: { approvalEnabled: false },
  };

  let cur = p;
  const n1History = [];
  const expHistory = [];
  for (let i = 0; i < 4; i += 1) {
    const { player } = editRecord(cur, { recordId: 'o1', count: 200, now: NOW });
    cur = player;
    n1History.push(cur.records.find((r) => r.id === 'n1').grantedExp);
    expHistory.push(cur.chars[0].exp);
  }

  // 現状（欠陥2）は n1 が 900 と 1350 を無限に交互する（900,1350,900,1350）。
  // 正しくは1回目で900に収束したあとは何度なおしても900のまま変わらないはず
  assert.deepEqual(n1History, [900, 900, 900, 900], 'n1のgrantedExpは発振せず900で安定するはず（現状は900,1350,900,1350と発振する＝欠陥2）');
  assert.deepEqual(expHistory, [BASE_EXP + 900, BASE_EXP + 900, BASE_EXP + 900, BASE_EXP + 900], 'expも同じ値で安定する');
});

// -----------------------------------------------------------------------------
// C6: 削除でEXPが増えない（クロスモード起因のもの限定）。
// 単一モードの日での丸め・レベル閾値による増加は既知の割り切り（罠6）として
// 対象外にする（recordEditSymmetric.test.js のL1〜L5・S1〜S4がその割り切りを
// 固定している）。ここではクロスモード（day全体の勝敗反転）に限定して、
// 高いほうを消しても増えないことを固定する
// -----------------------------------------------------------------------------

test('C6 削除の単調性（クロスモード限定）: ぴかり(いなずま,ノー1.5倍) ノー10(45)とワン30(30)がある日にノーを削除すると、その日は45→30に下がる（増えない）', () => {
  const p = base('pikari', 0);
  let cur = p;
  cur = addRecord(cur, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW }).player;
  assert.equal(cur.chars[0].exp, 45, '前提: ノーが勝者(10×3×1.5=45 > ワン30×1×1=30)');

  const { player, result } = deleteRecord(cur, { recordId: 'no1', now: NOW });
  assert.equal(player.chars[0].exp, 30, 'ワンが繰り上がって30になるが、削除前(45)より少ない');
  assert.equal(result.expDelta, -15, '削除でexpが増えることはない（クロスモード）');
  assert.ok(result.expDelta <= 0, '削除の単調性: クロスモードで増えてはいけない');
});

// -----------------------------------------------------------------------------
// C7: ランダム検証。同日2〜4件・両モード・Lv20/Lv50境界を含む状態で、
// 操作（承認順序・なおす）をランダムに並べても保存則(C1)が破れないはず。
// 再現性のため決定的な擬似乱数（mulberry32）で固定シードを使う
// -----------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test('C7 ランダム検証: 同日複数件・両モード・Lv20/Lv50境界を含む状態で承認順序をランダムに並べても保存則が破れない', () => {
  const trials = 300;
  const charBases = [
    ['happa', totalExpForLevel(20)], // Lv20境界（すくすく）
    ['kirara', totalExpForLevel(50)], // Lv50境界（きらめき）
  ];
  const violations = [];
  const kiraraStartLevels = [];

  for (let seed = 1; seed <= trials; seed += 1) {
    const rand = mulberry32(seed * 2654435761);
    const [charId, baseExpRaw] = charBases[seed % charBases.length];
    const offset = Math.floor(rand() * 3000) - 1000; // 境界のまわりをばらつかせる
    const startExp = Math.max(0, baseExpRaw + offset);
    if (charId === 'kirara') kiraraStartLevels.push(levelFromExp(startExp).level);

    const p = base(charId, startExp);
    p.settings.approvalEnabled = true;
    const baseExp0 = baseExpOfChar(p, charId); // records=[]なのでstartExpと同じ

    const n = 2 + (seed % 3); // 2〜4件
    let cur = p;
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const id = `r${i}`;
      ids.push(id);
      const mode = rand() < 0.5 ? 'no' : 'one';
      const count = 1 + Math.floor(rand() * 400);
      const hour = String(9 + i).padStart(2, '0');
      cur = addRecord(cur, {
        id, count, mode, date: '2026-07-20', now: `2026-07-20T${hour}:00:00.000Z`,
      }).player;
    }

    const order = shuffle(ids, rand);
    for (const id of order) {
      const found = cur.pending.find((q) => q.id === id);
      cur = approvePending(cur, { pendingId: id, count: found.count, now: NOW }).player;
      const c = checkConservation(cur, charId, baseExp0);
      if (c.actual !== c.expected) violations.push({ seed, step: `approve ${id}`, ...c });
    }

    // 追加でランダムに「なおす」を1〜2回
    const editCount = seed % 3;
    for (let e = 0; e < editCount; e += 1) {
      const targetId = ids[Math.floor(rand() * ids.length)];
      if (!cur.records.some((r) => r.id === targetId)) continue;
      const newCount = 1 + Math.floor(rand() * 400);
      cur = editRecord(cur, { recordId: targetId, count: newCount, now: NOW }).player;
      const c = checkConservation(cur, charId, baseExp0);
      if (c.actual !== c.expected) violations.push({ seed, step: `edit ${targetId}`, ...c });
    }
  }

  assert.ok(kiraraStartLevels.some((level) => level < 50), 'きららのLv50未満を試せている');
  assert.ok(kiraraStartLevels.some((level) => level >= 50), 'きららのLv50以上を試せている');

  assert.equal(
    violations.length,
    0,
    `保存則が破れたトライアルが${violations.length}件ある（欠陥1・2の再発検知）: ${JSON.stringify(violations.slice(0, 5))}`,
  );
});

// =============================================================================
// A1・A2: 欠陥A（isLegacyDayによる日ごとの帳簿切り替え）の回帰網。2026-07-29。
//
// isLegacyDay は「敗者モードなのに0でない値が残っている日」をv10由来と決めつけて
// beforeを保存値に切り替えるが、この判定は**額**ではなく**帳簿の形**しか見ていない。
// 別の日の編集・追加でリプレイ上その日の勝者モードが入れ替わると、v11の正しい
// 記録でも「形」だけがv10に見えてしまい、記録側だけ上書きされてexpに反映されない
// 差額が生まれる（かつ isLegacyDay が false のときも、非legacy日のbeforeは
// 「編集対象グループのリプレイ値」であり「保存値」と一致するとは限らないため、
// 別グループの編集を挟むと保存則が破れる。C1のコメントも参照）。
//
// 当初の指示どおり「beforeは常にそのキャラの保存値の合計」に統一すれば
// （isLegacyDay分岐を廃止すれば）、この2件は起きないことをレビュアーは実測している。
// 実装(js/core/player.js)は未変更なので、A1・A2は現状の実装に対して FAIL する想定
// （それが目的）。
// =============================================================================

/** その時点でのキャラのexpが「基準 + Σ現在のgrantedExp」と一致するか検査する */
function assertNoFreeExp(player, charId, baseExp0, label) {
  const granted = player.records
    .filter((r) => r.charId === charId && Number.isFinite(r.grantedExp))
    .reduce((s, r) => s + r.grantedExp, 0);
  const predicted = baseExp0 + granted;
  const entry = player.chars.find((c) => c.charId === charId);
  const actual = entry ? entry.exp : null;
  if (predicted < 0) {
    assert.equal(actual, 0, `${label}: クランプに当たったはずなのに0でない (predicted=${predicted}, actual=${actual})`);
    return;
  }
  assert.equal(actual, predicted, `${label}: 保存則が破れている (expected=${predicted}, actual=${actual})`);
}

// レビュアーの「9手の再現」（はっぱ・すくすく Lv20境界・さかのぼり入力のみ）。
// 「なおす」「けす」は一度も使わず、addRecord（さかのぼりのある記録追加）だけで
// 保存則が破れることを、手順1つずつ検査する
test('A1 再現手順（9手・さかのぼり入力のみ）: 手順ごとに exp == 基準 + Σ grantedExp が成り立つこと', () => {
  const p = base('happa', 0);
  const baseExp0 = 0;

  const steps = [
    { date: '2026-07-16', mode: 'no', count: 570 },
    { date: '2026-07-20', mode: 'one', count: 435 },
    { date: '2026-07-17', mode: 'one', count: 496 },
    { date: '2026-07-16', mode: 'no', count: 216 },
    { date: '2026-07-18', mode: 'one', count: 548 },
    { date: '2026-07-17', mode: 'no', count: 316 },
    { date: '2026-07-21', mode: 'one', count: 596 },
    { date: '2026-07-18', mode: 'one', count: 114 },
    { date: '2026-07-17', mode: 'one', count: 282 },
  ];

  let cur = p;
  steps.forEach((s, i) => {
    const now = `2026-07-22T${String(9 + i).padStart(2, '0')}:00:00.000Z`;
    cur = addRecord(cur, {
      id: `r${i + 1}`, count: s.count, mode: s.mode, date: s.date, now,
    }).player;
    assertNoFreeExp(cur, 'happa', baseExp0, `手順${i + 1} (${s.date} ${s.mode}${s.count})`);
  });

  // レビュアーの表と一致することも固定しておく（現状の実装は手順8・9で
  // 記録の合計(7878→6974)とexp(7330→6426)が548ずれ、9手目でLv23→Lv22に落ちる）
  const sumGranted = cur.records.reduce((s, r) => s + (r.grantedExp || 0), 0);
  assert.equal(cur.chars[0].exp, sumGranted, '9手すべて終えた時点でも exp と記録の合計は一致するはず（現状は548ズレる想定）');
});

// 「追加だけ・さかのぼりあり」の乱数セッションで保存則が破れないこと。
// mulberry32で決定的に固定したシードを使う（再現性のため）。3000トライアルで
// 現状の実装は数件（0.1%程度）の破れを検出する
test('A2 ランダム検証（追加だけ・さかのぼりあり）: addRecordのみ・過去日への記録追加を混ぜても保存則が破れないこと', () => {
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function addDays(dateStr, delta) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  const TRIALS = 3000;
  const charBases = [
    ['happa', totalExpForLevel(20)],
    ['kirara', totalExpForLevel(50) - 200],
  ]; // すくすく/きらめきの境界付近
  const violations = [];

  for (let seed = 1; seed <= TRIALS; seed += 1) {
    const rand = mulberry32(seed * 2654435761);
    const [charId, boundary] = charBases[seed % charBases.length];
    const startExp = Math.max(0, boundary + Math.floor(rand() * 2000) - 1000);
    let cur = base(charId, startExp);
    const baseExp0 = startExp;
    const n = 3 + Math.floor(rand() * 4); // 3〜6件

    for (let i = 0; i < n; i += 1) {
      const date = addDays('2026-07-22', -Math.floor(rand() * 10));
      const mode = rand() < 0.5 ? 'no' : 'one';
      const count = 1 + Math.floor(rand() * 400);
      const now = `2026-07-22T${String(9 + i).padStart(2, '0')}:00:00.000Z`;
      cur = addRecord(cur, {
        id: `r${i}`, count, mode, date, now,
      }).player;

      const sumGranted = cur.records.reduce((s, r) => s + (r.grantedExp || 0), 0);
      const predicted = baseExp0 + sumGranted;
      if (predicted >= 0 && cur.chars[0].exp !== predicted) {
        violations.push({
          seed, charId, step: i, predicted, actual: cur.chars[0].exp, delta: cur.chars[0].exp - predicted,
        });
        break;
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `追加だけ・さかのぼりありの乱数セッションで保存則が破れた${violations.length}/${TRIALS}件（欠陥Aの再発検知）: ${JSON.stringify(violations.slice(0, 5))}`,
  );
});

// -----------------------------------------------------------------------------
// C1（報告）: isLegacyDay 廃止後、v11の操作だけでlegacy判定に相当する分岐が
// 発火しないこと。
//
// isLegacyDay は js/core/player.js の非exportの内部関数であり、直接importして
// 呼び出すことはできない。また、当初方針どおり「beforeは常に保存値」を実装すると
// isLegacyDay分岐そのものが（grantedBeforeByChar から）消えるため、「分岐が
// 発火しないこと」を検査する対象そのものが実装から無くなる。
// タスク文の「分岐自体が無くなるなら不要。その旨を報告」に従い、C1は独立した
// テストとしては書いていない。isLegacyDayが「額ではなく帳簿の形」で誤判定する
// ことによる保存則の破れは、v11操作のみで構成したA2（本ファイル）と
// C7（本ファイル・承認順序＋なおすのランダム検証）が既にカバーしている
// （どちらも手作りのv10風フィクスチャを一切使わない）。
// -----------------------------------------------------------------------------
