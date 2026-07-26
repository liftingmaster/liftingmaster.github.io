import { getCharacter } from './characters.js';

/**
 * 特性IDごとの倍率計算。
 * ctx = { level, mode, count, isPersonalBest, currentStreak }
 */
const RULES = {
  moeagaru: (ctx) => (ctx.isPersonalBest ? 1.5 : 1),
  shimikomu: (ctx) => (ctx.currentStreak >= 3 ? 1.2 : 1),
  sukusuku: (ctx) => (ctx.level <= 20 ? 2 : 1),
  inazuma: (ctx) => (ctx.mode === 'no' ? 1.5 : 1),
  fuwafuwa: (ctx) => (ctx.mode === 'one' ? 2 : 1),
  kirameki: (ctx) => (ctx.level >= 50 ? 1.5 : 1),
  dosshiri: (ctx) => (ctx.currentStreak >= 10 ? 1.5 : 1),
  reisei: (ctx) => (ctx.mode === 'no' && ctx.count >= 20 ? 2 : 1),
  yaminochikara: () => 1.3,
};

/** そのキャラの特性によるEXP倍率を返す */
export function abilityRate(charId, ctx) {
  const char = getCharacter(charId);
  const rule = RULES[char.ability.id];
  if (!rule) throw new Error(`unknown ability id: ${char.ability.id}`);
  return rule(ctx);
}
