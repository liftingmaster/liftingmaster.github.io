import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEVEL, expToNext, levelFromExp, totalExpForLevel } from '../js/core/exp.js';

test('MAX_LEVEL は 100', () => {
  assert.equal(MAX_LEVEL, 100);
});

test('expToNext は 3 * level^1.8 を四捨五入した値', () => {
  assert.equal(expToNext(1), 3);
  assert.equal(expToNext(2), 10);
  assert.equal(expToNext(10), 189);
  assert.equal(expToNext(30), 1368);
  assert.equal(expToNext(50), 3430);
  assert.equal(expToNext(99), 11729);
});

test('expToNext は Lv100 以上で 0（それ以上上がらない）', () => {
  assert.equal(expToNext(100), 0);
  assert.equal(expToNext(101), 0);
});

test('levelFromExp: EXP0 は Lv1', () => {
  assert.deepEqual(levelFromExp(0), { level: 1, expIntoLevel: 0, expToNextLevel: 3 });
});

test('levelFromExp: ちょうど足りたらレベルが上がる', () => {
  assert.equal(levelFromExp(2).level, 1);
  assert.equal(levelFromExp(3).level, 2);
  assert.equal(levelFromExp(12).level, 2);
  assert.equal(levelFromExp(13).level, 3);
});

test('levelFromExp: レベル内の残EXPと次までの必要量を返す', () => {
  const r = levelFromExp(12);
  assert.equal(r.level, 2);
  assert.equal(r.expIntoLevel, 9);
  assert.equal(r.expToNextLevel, 10);
});

test('levelFromExp: Lv100 で頭打ちになる', () => {
  const r = levelFromExp(999999);
  assert.equal(r.level, 100);
  assert.equal(r.expToNextLevel, 0);
});

test('totalExpForLevel: Lv100 到達には 420590 EXP 必要', () => {
  assert.equal(totalExpForLevel(1), 0);
  assert.equal(totalExpForLevel(2), 3);
  assert.equal(totalExpForLevel(10), 584);
  assert.equal(totalExpForLevel(100), 420590);
});

test('負のEXPは Lv1 として扱う', () => {
  assert.equal(levelFromExp(-5).level, 1);
});
