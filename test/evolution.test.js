import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolutionStage, evolutionProgress } from '../js/core/evolution.js';

const ctx = (over = {}) => ({ level: 1, bestNo: 0, bestOne: 0, longestStreak: 0, ...over });

// ひのこ 第1進化: Lv15 / ノー15 or ワン50 / 連続5日
// ひのこ 第2進化: Lv45 / ノー40 / 連続14日

test('条件を満たさなければ段階0', () => {
  assert.equal(evolutionStage('hinoko', ctx()), 0);
});

test('3条件すべて満たすと第1進化', () => {
  assert.equal(evolutionStage('hinoko', ctx({ level: 15, bestNo: 15, longestStreak: 5 })), 1);
});

test('1つでも欠けると進化しない（AND）', () => {
  assert.equal(evolutionStage('hinoko', ctx({ level: 14, bestNo: 15, longestStreak: 5 })), 0);
  assert.equal(evolutionStage('hinoko', ctx({ level: 15, bestNo: 14, longestStreak: 5 })), 0);
  assert.equal(evolutionStage('hinoko', ctx({ level: 15, bestNo: 15, longestStreak: 4 })), 0);
});

test('第1進化はワンバウンドでも達成できる', () => {
  assert.equal(evolutionStage('hinoko', ctx({ level: 15, bestNo: 0, bestOne: 50, longestStreak: 5 })), 1);
  assert.equal(evolutionStage('hinoko', ctx({ level: 15, bestNo: 0, bestOne: 49, longestStreak: 5 })), 0);
});

test('第2進化はワンバウンドでは達成できない', () => {
  const c = ctx({ level: 45, bestNo: 15, bestOne: 9999, longestStreak: 14 });
  assert.equal(evolutionStage('hinoko', c), 1, 'ワンがいくら高くても第2進化はしない');
  assert.equal(evolutionStage('hinoko', { ...c, bestNo: 40 }), 2);
});

test('第2進化の条件を満たせば段階2', () => {
  assert.equal(evolutionStage('hinoko', ctx({ level: 45, bestNo: 40, longestStreak: 14 })), 2);
});

test('第1進化を飛ばして第2進化の条件だけ満たした場合も段階2になる', () => {
  // レベルが一気に上がるケース。段階は「満たしている最大の段階」
  assert.equal(evolutionStage('hinoko', ctx({ level: 99, bestNo: 100, longestStreak: 60 })), 2);
});

test('もくもの第1進化はワン30で達成できる', () => {
  assert.equal(evolutionStage('mokumo', ctx({ level: 15, bestOne: 30, longestStreak: 5 })), 1);
  assert.equal(evolutionStage('mokumo', ctx({ level: 15, bestOne: 29, longestStreak: 5 })), 0);
});

test('evolutionProgress: 未達項目が分かる', () => {
  const p = evolutionProgress('hinoko', 1, ctx({ level: 15, bestNo: 12, bestOne: 0, longestStreak: 5 }));
  assert.equal(p.met, false);
  assert.equal(p.items.length, 3);

  const levelItem = p.items.find((i) => i.label.includes('レベル'));
  assert.equal(levelItem.done, true);
  assert.equal(levelItem.current, 15);
  assert.equal(levelItem.required, 15);

  const skillItem = p.items[1];
  assert.equal(skillItem.done, false);
  assert.equal(skillItem.current, 12);
  assert.equal(skillItem.required, 15);

  const streakItem = p.items[2];
  assert.equal(streakItem.done, true);
});

test('evolutionProgress: 第1進化の実力項目はノーとワンの良い方で判定する', () => {
  // ノー12/15 と ワン45/50 なら、達成率の高いワン側を current に採用
  const p = evolutionProgress('hinoko', 1, ctx({ level: 15, bestNo: 12, bestOne: 45, longestStreak: 5 }));
  const skillItem = p.items[1];
  assert.equal(skillItem.done, false);
  assert.equal(skillItem.required, 50);
  assert.equal(skillItem.current, 45);
});

test('evolutionProgress: すべて達成なら met が true', () => {
  const p = evolutionProgress('hinoko', 1, ctx({ level: 15, bestNo: 15, longestStreak: 5 }));
  assert.equal(p.met, true);
  assert.ok(p.items.every((i) => i.done));
});

test('evolutionProgress: 存在しない段階は null', () => {
  assert.equal(evolutionProgress('hinoko', 3, ctx()), null);
});
