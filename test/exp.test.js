import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEVEL, expToNext, levelFromExp, totalExpForLevel } from '../js/core/exp.js';

test('MAX_LEVEL は 100', () => {
  assert.equal(MAX_LEVEL, 100);
});

test('expToNext は 0.3 * level^1.8 を四捨五入し、最低1 EXPを必要とする', () => {
  assert.equal(expToNext(1), 1);
  assert.equal(expToNext(2), 1);
  assert.equal(expToNext(10), 19);
  assert.equal(expToNext(30), 137);
  assert.equal(expToNext(50), 343);
  assert.equal(expToNext(99), 1173);
});

test('expToNext は Lv100 以上で 0（それ以上上がらない）', () => {
  assert.equal(expToNext(100), 0);
  assert.equal(expToNext(101), 0);
});

test('levelFromExp: EXP0 は Lv1', () => {
  assert.deepEqual(levelFromExp(0), { level: 1, expIntoLevel: 0, expToNextLevel: 1 });
});

test('levelFromExp: ちょうど足りたらレベルが上がる', () => {
  assert.equal(levelFromExp(0).level, 1);
  assert.equal(levelFromExp(1).level, 2);
  assert.equal(levelFromExp(2).level, 3);
  assert.equal(levelFromExp(4).level, 4);
});

test('levelFromExp: レベル内の残EXPと次までの必要量を返す', () => {
  const r = levelFromExp(3);
  assert.equal(r.level, 3);
  assert.equal(r.expIntoLevel, 1);
  assert.equal(r.expToNextLevel, 2);
});

test('levelFromExp: Lv100 で頭打ちになる', () => {
  const r = levelFromExp(999999);
  assert.equal(r.level, 100);
  assert.equal(r.expToNextLevel, 0);
});

test('totalExpForLevel: Lv100 到達には 42061 EXP 必要', () => {
  assert.equal(totalExpForLevel(1), 0);
  assert.equal(totalExpForLevel(2), 1);
  assert.equal(totalExpForLevel(10), 60);
  assert.equal(totalExpForLevel(100), 42061);
});

test('負のEXPは Lv1 として扱う', () => {
  assert.equal(levelFromExp(-5).level, 1);
});
