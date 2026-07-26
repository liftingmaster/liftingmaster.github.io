export const MAX_LEVEL = 100;

/** 現在レベルから次のレベルに上がるのに必要なEXP。Lv100以上は0 */
export function expToNext(level) {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(3 * Math.pow(level, 1.8));
}

/** 累計EXPからレベルと内訳を求める */
export function levelFromExp(totalExp) {
  let remaining = Math.max(0, Math.floor(totalExp));
  let level = 1;
  while (level < MAX_LEVEL) {
    const need = expToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return {
    level,
    expIntoLevel: level >= MAX_LEVEL ? 0 : remaining,
    expToNextLevel: expToNext(level),
  };
}

/** そのレベルに到達するまでの累計EXP */
export function totalExpForLevel(level) {
  let total = 0;
  for (let n = 1; n < level && n < MAX_LEVEL; n += 1) {
    total += expToNext(n);
  }
  return total;
}
