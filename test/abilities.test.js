import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abilityRate } from '../js/core/abilities.js';

const ctx = (over = {}) => ({
  level: 30, mode: 'no', count: 10, isPersonalBest: false, currentStreak: 1, ...over,
});

test('ひのこ もえあがる: 自己ベスト更新で1.5倍', () => {
  assert.equal(abilityRate('hinoko', ctx({ isPersonalBest: true })), 1.5);
  assert.equal(abilityRate('hinoko', ctx({ isPersonalBest: false })), 1);
});

test('しずく しみこむ: 連続3日以上で1.2倍（境界は2日で対象外・3日で対象）', () => {
  assert.equal(abilityRate('shizuku', ctx({ currentStreak: 2 })), 1);
  assert.equal(abilityRate('shizuku', ctx({ currentStreak: 3 })), 1.2);
});

test('はっぱ すくすく: Lv20以下で2倍（境界は20で対象・21で対象外）', () => {
  assert.equal(abilityRate('happa', ctx({ level: 20 })), 2);
  assert.equal(abilityRate('happa', ctx({ level: 21 })), 1);
});

test('ぴかり いなずま: ノーバウンドのみ1.5倍', () => {
  assert.equal(abilityRate('pikari', ctx({ mode: 'no' })), 1.5);
  assert.equal(abilityRate('pikari', ctx({ mode: 'one' })), 1);
});

test('もくも ふわふわ: ワンバウンドのみ2倍', () => {
  assert.equal(abilityRate('mokumo', ctx({ mode: 'one' })), 2);
  assert.equal(abilityRate('mokumo', ctx({ mode: 'no' })), 1);
});

test('きらら きらめき: Lv50以上で1.5倍（境界は49で対象外・50で対象）', () => {
  assert.equal(abilityRate('kirara', ctx({ level: 49 })), 1);
  assert.equal(abilityRate('kirara', ctx({ level: 50 })), 1.5);
});

test('がんろ どっしり: 連続10日以上で1.5倍（境界は9で対象外・10で対象）', () => {
  assert.equal(abilityRate('ganro', ctx({ currentStreak: 9 })), 1);
  assert.equal(abilityRate('ganro', ctx({ currentStreak: 10 })), 1.5);
});

test('こおる れいせい: ノーバウンド20回以上で2倍（境界は19で対象外・20で対象）', () => {
  assert.equal(abilityRate('kooru', ctx({ mode: 'no', count: 19 })), 1);
  assert.equal(abilityRate('kooru', ctx({ mode: 'no', count: 20 })), 2);
  assert.equal(abilityRate('kooru', ctx({ mode: 'one', count: 100 })), 1);
});

test('かげろ やみのちから: 条件なしで常に1.3倍', () => {
  assert.equal(abilityRate('kagero', ctx()), 1.3);
  assert.equal(abilityRate('kagero', ctx({ mode: 'one', level: 1 })), 1.3);
});

test('未知のキャラIDは例外', () => {
  assert.throws(() => abilityRate('nazono', ctx()), /nazono/);
});
