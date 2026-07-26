import { MODE_RATE } from './characters.js';
import { dailyBest, personalBest, recordedDates } from './stats.js';
import { currentStreak } from './streak.js';
import { abilityRate } from './abilities.js';
import { levelFromExp } from './exp.js';

/**
 * 記録1件で得られるEXPを計算する。
 * records には「この記録を含まない」確定済み記録を渡すこと。
 *
 * 日別ベストの差分方式により、同じ日・同じモードの記録は
 * どの順番で適用しても合計EXPが一致する（テストで担保）。
 * ただし「もえあがる」のように自己ベスト更新で倍率が変わる特性では、
 * 更新が起きた記録に倍率が乗るため、順序で合計が変わりうる。
 * 実運用では承認を古い順に処理するため問題にならない。
 */
export function computeGain({ records, record, charId, charExp }) {
  const oldDailyBest = dailyBest(records, record.date, record.mode);
  const newDailyBest = Math.max(oldDailyBest, record.count);
  const delta = Math.max(0, record.count - oldDailyBest);

  const isPersonalBest = record.count > personalBest(records, record.mode);
  const { level } = levelFromExp(charExp);

  // 連続日数はこの記録を含めて数える
  const datesWithThis = [...recordedDates(records), record.date];
  const streak = currentStreak(datesWithThis, record.date);

  const rate = MODE_RATE[record.mode] * abilityRate(charId, {
    level, mode: record.mode, count: record.count, isPersonalBest, currentStreak: streak,
  });

  return {
    exp: Math.round(delta * rate),
    isPersonalBest,
    oldDailyBest,
    newDailyBest,
    rate,
  };
}
