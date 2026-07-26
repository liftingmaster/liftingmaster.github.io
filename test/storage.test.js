import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, createInitialState, createPlayer, validateState,
  load, save, exportJson, importJson,
} from '../js/storage.js';

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
  assert.equal(s.version, 1);
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
  s.version = 2;
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

test('load: 2回目の破損は .broken.2 に退避し、1回目の .broken は残る', () => {
  const st = fakeStorage({ [STORAGE_KEY]: '{first-broken' });
  load(st);
  assert.equal(st.data[`${STORAGE_KEY}.broken`], '{first-broken');

  st.data[STORAGE_KEY] = '{second-broken';
  load(st);
  assert.equal(st.data[`${STORAGE_KEY}.broken`], '{first-broken');
  assert.equal(st.data[`${STORAGE_KEY}.broken.2`], '{second-broken');
});
