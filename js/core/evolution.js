import { getCharacter } from './characters.js';

/** その段階の条件をすべて満たしているか */
function meetsStage(evo, ctx) {
  if (ctx.level < evo.level) return false;
  if (ctx.longestStreak < evo.streak) return false;

  const byNo = ctx.bestNo >= evo.noCount;
  const byOne = evo.oneCount !== null && ctx.bestOne >= evo.oneCount;
  return byNo || byOne;
}

/** 現在の進化段階（満たしている最大の段階）を返す */
export function evolutionStage(charId, ctx) {
  const char = getCharacter(charId);
  let stage = 0;
  for (const evo of char.evolutions) {
    if (meetsStage(evo, ctx)) stage = evo.stage;
  }
  return stage;
}

/**
 * 目標段階に対する進捗を返す。画面のチェックリスト表示に使う。
 * 実力項目は、第1進化では「ノーとワンのうち達成率が高い方」を表示する。
 */
export function evolutionProgress(charId, stage, ctx) {
  const char = getCharacter(charId);
  const evo = char.evolutions.find((e) => e.stage === stage);
  if (!evo) return null;

  const levelItem = {
    label: `レベル ${evo.level}`,
    done: ctx.level >= evo.level,
    current: ctx.level,
    required: evo.level,
  };

  const noRatio = evo.noCount > 0 ? ctx.bestNo / evo.noCount : 0;
  const oneRatio = evo.oneCount ? ctx.bestOne / evo.oneCount : -1;
  const useOne = oneRatio > noRatio;

  const skillItem = useOne
    ? { label: `ワンバウンド ${evo.oneCount}かい`, done: ctx.bestOne >= evo.oneCount, current: ctx.bestOne, required: evo.oneCount }
    : { label: `ノーバウンド ${evo.noCount}かい`, done: ctx.bestNo >= evo.noCount, current: ctx.bestNo, required: evo.noCount };

  const streakItem = {
    label: `${evo.streak}にち れんぞく`,
    done: ctx.longestStreak >= evo.streak,
    current: ctx.longestStreak,
    required: evo.streak,
  };

  const items = [levelItem, skillItem, streakItem];
  return { met: meetsStage(evo, ctx), items };
}
