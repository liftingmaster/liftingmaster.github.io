import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGain } from '../js/core/gain.js';

const rec = (date, mode, count, seq = 0) => ({
  id: `${date}-${mode}-${count}-${seq}`, date, mode, count,
  createdAt: `${date}T${String(10 + seq).padStart(2, '0')}:00:00.000Z`,
});

// 特性の影響を受けにくいキャラで基本計算を確かめる（ぴかりはノー1.5倍なので使わない）
// かげろは常時1.3倍なので基本計算にも使わない。ひのこは自己ベスト更新時のみ1.5倍。

test('最初の記録: 回数 × モード係数（ノー×3）', () => {
  // ひのこ Lv1、自己ベスト更新なので 1.5倍がかかる
  const r = computeGain({ records: [], record: rec('2026-07-01', 'no', 8), charId: 'hinoko', charExp: 0 });
  assert.equal(r.oldDailyBest, 0);
  assert.equal(r.newDailyBest, 8);
  assert.equal(r.isPersonalBest, true);
  assert.equal(r.exp, Math.round(8 * 3 * 1.5)); // 36
});

test('同じ日にベストを更新したら差分だけEXPが入る', () => {
  const records = [rec('2026-07-01', 'no', 8)];
  const r = computeGain({ records, record: rec('2026-07-01', 'no', 12, 1), charId: 'hinoko', charExp: 0 });
  assert.equal(r.oldDailyBest, 8);
  assert.equal(r.newDailyBest, 12);
  assert.equal(r.exp, Math.round((12 - 8) * 3 * 1.5)); // 18
});

test('同じ日にベスト未満ならEXPは0', () => {
  const records = [rec('2026-07-01', 'no', 12)];
  const r = computeGain({ records, record: rec('2026-07-01', 'no', 5, 1), charId: 'hinoko', charExp: 0 });
  assert.equal(r.exp, 0);
  assert.equal(r.isPersonalBest, false);
});

test('同点はベスト更新とみなさない（EXP0）', () => {
  const records = [rec('2026-07-01', 'no', 10)];
  const r = computeGain({ records, record: rec('2026-07-01', 'no', 10, 1), charId: 'hinoko', charExp: 0 });
  assert.equal(r.exp, 0);
  assert.equal(r.isPersonalBest, false);
});

test('ワンバウンドは係数1', () => {
  // もくも Lv1: ワンバウンド2倍
  const r = computeGain({ records: [], record: rec('2026-07-01', 'one', 50), charId: 'mokumo', charExp: 0 });
  assert.equal(r.exp, Math.round(50 * 1 * 2)); // 100
  // ノーバウンドなら もくもの特性は乗らない
  const r2 = computeGain({ records: [], record: rec('2026-07-01', 'no', 10), charId: 'mokumo', charExp: 0 });
  assert.equal(r2.exp, Math.round(10 * 3 * 1)); // 30
});

test('レベル条件の特性は charExp から導いたレベルで判定する', () => {
  // はっぱ すくすく: Lv20以下で2倍。Lv20到達には累計4384EXP、Lv21には5043EXP
  const atLv20 = computeGain({ records: [], record: rec('2026-07-01', 'one', 10), charId: 'happa', charExp: 4384 });
  assert.equal(atLv20.exp, Math.round(10 * 1 * 2)); // 20

  const atLv21 = computeGain({ records: [], record: rec('2026-07-01', 'one', 10), charId: 'happa', charExp: 5043 });
  assert.equal(atLv21.exp, Math.round(10 * 1 * 1)); // 10
});

test('連続日数の特性はその記録を含めた連続日数で判定する', () => {
  // しずく しみこむ: 連続3日以上で1.2倍
  const records = [rec('2026-07-01', 'one', 5), rec('2026-07-02', 'one', 5)];
  const r = computeGain({ records, record: rec('2026-07-03', 'one', 10), charId: 'shizuku', charExp: 0 });
  assert.equal(r.rate, 1 * 1.2);
  assert.equal(r.exp, Math.round(10 * 1 * 1.2)); // 12
});

test('computeGain: 引数の records を書き換えない', () => {
  const records = [rec('2026-07-01', 'no', 8)];
  const copy = JSON.parse(JSON.stringify(records));
  computeGain({ records, record: rec('2026-07-01', 'no', 12, 1), charId: 'mokumo', charExp: 0 });
  assert.deepEqual(records, copy);
});

test('同じ日のベスト差分方式なので、適用順を変えても合計が一致する', () => {
  // 8 → 12 → 5 の順に足しても、5 → 12 → 8 の順に足しても、合計は 12 × 3 になる
  const apply = (counts) => {
    let acc = [];
    let total = 0;
    counts.forEach((count, i) => {
      const record = rec('2026-07-01', 'no', count, i);
      total += computeGain({ records: acc, record, charId: 'mokumo', charExp: 0 }).exp;
      acc = [...acc, record];
    });
    return total;
  };
  assert.equal(apply([8, 12, 5]), 36);
  assert.equal(apply([5, 12, 8]), 36);
  assert.equal(apply([12, 8, 5]), 36);
});
