import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNLOCK_LEVELS, pendingUnlocks, nextUnlock } from '../js/core/unlock.js';

test('解放レベルは8段階', () => {
  assert.deepEqual(UNLOCK_LEVELS, [10, 20, 30, 40, 50, 65, 80, 100]);
});

test('Lv9 では解放なし', () => {
  assert.deepEqual(pendingUnlocks(9, ['hinoko']), []);
});

test('Lv10 で御三家の残り2体から1体を選ぶ', () => {
  const p = pendingUnlocks(10, ['hinoko']);
  assert.equal(p.length, 1);
  assert.equal(p[0].level, 10);
  assert.deepEqual(p[0].choices.sort(), ['happa', 'shizuku']);
});

test('Lv20 で御三家の最後の1体が自動で決まる', () => {
  const p = pendingUnlocks(20, ['hinoko', 'shizuku']);
  assert.equal(p.length, 1);
  assert.equal(p[0].level, 20);
  assert.deepEqual(p[0].choices, ['happa']);
});

test('Lv30 で ぴかり が解放される', () => {
  const p = pendingUnlocks(30, ['hinoko', 'shizuku', 'happa']);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].choices, ['pikari']);
});

test('複数の解放を飛ばしていたらまとめて返る（古い順）', () => {
  const p = pendingUnlocks(40, ['hinoko']);
  assert.deepEqual(p.map((x) => x.level), [10, 20, 30, 40]);
  assert.deepEqual(p[2].choices, ['pikari']);
  assert.deepEqual(p[3].choices, ['mokumo']);
});

test('受け取り済みのキャラは選択肢から消える', () => {
  const p = pendingUnlocks(100, ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru', 'kagero']);
  assert.deepEqual(p, []);
});

test('Lv100 で かげろ が解放される', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru'];
  const p = pendingUnlocks(100, owned);
  assert.deepEqual(p.map((x) => x.level), [100]);
  assert.deepEqual(p[0].choices, ['kagero']);
});

test('nextUnlock は次の解放を予告する', () => {
  assert.deepEqual(nextUnlock(1), { level: 10, charId: null });
  assert.deepEqual(nextUnlock(25), { level: 30, charId: 'pikari' });
  assert.deepEqual(nextUnlock(80), { level: 100, charId: 'kagero' });
});

test('nextUnlock は Lv100 到達後は null', () => {
  assert.equal(nextUnlock(100), null);
});
