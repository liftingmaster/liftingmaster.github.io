import { CHARACTERS, STARTER_IDS } from './characters.js';

export const UNLOCK_LEVELS = [10, 20, 40, 50, 65, 80, 100];

/**
 * Lv10 と Lv20 は御三家の残りから、それ以外は unlockLevel が一致するキャラ。
 * Lv10・Lv20 は「まだ御三家を何体持っているか」の閾値（2体未満/3体未満）が違うだけで、
 * 候補の出し方（持っていない御三家を返す）自体は同じロジックなのでまとめている。
 */
function candidatesFor(level, ownedIds) {
  const owned = new Set(ownedIds);
  const ownedStarters = STARTER_IDS.filter((id) => owned.has(id)).length;

  const starterThreshold = level === 10 ? 2 : level === 20 ? 3 : null;
  if (starterThreshold !== null) {
    if (ownedStarters >= starterThreshold) return []; // この節目はもう完了している
    return STARTER_IDS.filter((id) => !owned.has(id));
  }

  return CHARACTERS.filter((c) => c.unlockLevel === level && !owned.has(c.id)).map((c) => c.id);
}

/**
 * 進化由来（レベルの節目ではなく、なかまの誰かが特定の進化段階を実現したこと）で
 * 解放されるキャラの候補。unlockOnEvolvedStage を持つキャラだけが対象。
 *
 * maxEvolvedStageEver は「そのプレイヤーが実現した（evolvedStages に積まれた）
 * 進化段階の最大値」という数値ひとつ。player 全体を渡さないのは unlock.js を
 * 純粋関数のまま保つため（DOM・localStorage・player構造への依存を持ち込まない）。
 * 判定は maxEvolvedStageEver >= c.unlockOnEvolvedStage（「以上を実現した」）。
 * includes(1) のような決め打ちは、0→2 の一気進化（stage1をすっ飛ばす）を
 * 取りこぼすので使わない。
 */
function evolutionCandidatesFor(maxEvolvedStageEver, ownedIds) {
  const owned = new Set(ownedIds);
  return CHARACTERS.filter(
    (c) => typeof c.unlockOnEvolvedStage === 'number'
      && !owned.has(c.id)
      && maxEvolvedStageEver >= c.unlockOnEvolvedStage,
  ).map((c) => c.id);
}

/**
 * まだ受け取っていない解放を古い順に返す。
 *
 * 【重要】返り値の各エントリは「1件ずつ順番に受け取る」ことを前提にしている。
 * Lv10 の御三家選択が確定するまでは「最後に残る御三家」が定まらないため、
 * 例えば pendingUnlocks(40, ['hinoko']) は Lv10・Lv20 の両方に
 * choices=['shizuku','happa'] を返す（Lv20 はまだ2択に見える）。
 * これは仕様通りで、呼び出し側は Lv10 の選択を確定させてから
 * pendingUnlocks を再計算する必要がある。再計算すると Lv20 は
 * 残った御三家1体だけの自動付与として返る。配列を先読みして
 * 一度に両方の選択肢を提示してはいけない。
 *
 * 進化由来の解放（ぴかり）は必ずレベル由来のあとに並ぶ。エントリの形は
 * { level: null, kind: 'evolution', stage, choices } でレベル由来の
 * { level, choices } と区別できる（呼び出し側が `Lv${unlock.level}` を
 * 組み立てるときに level が null であることで進化由来と分岐できるように）。
 *
 * maxEvolvedStageEver は既定 0（誰も進化を実現していない）。
 */
export function pendingUnlocks(maxLevelEver, ownedIds, maxEvolvedStageEver = 0) {
  const result = [];
  for (const level of UNLOCK_LEVELS) {
    if (maxLevelEver < level) break;
    const choices = candidatesFor(level, ownedIds);
    if (choices.length > 0) result.push({ level, choices });
  }
  const evoChoices = evolutionCandidatesFor(maxEvolvedStageEver, ownedIds);
  if (evoChoices.length > 0) {
    result.push({
      level: null, kind: 'evolution', stage: 1, choices: evoChoices,
    });
  }
  return result;
}

/**
 * 次に解放されるものの予告。御三家からの選択は charId が null。
 *
 * これは maxLevelEver だけを見た「先の予告」であり、まだ受け取っていない
 * 解放（pending）があるかどうかは考慮しない。そのため、ちょうど節目の
 * レベルに到達した瞬間は「その節目」ではなく「次の節目」を返す
 * （例: nextUnlock(30) は Lv30 のぴかりではなく Lv40 のもくもを返す）。
 * 「今受け取れるものは何か」を知りたい呼び出し側は nextUnlock ではなく
 * pendingUnlocks を使うこと。
 */
export function nextUnlock(maxLevelEver) {
  const level = UNLOCK_LEVELS.find((l) => l > maxLevelEver);
  if (level === undefined) return null;
  if (level === 10 || level === 20) return { level, charId: null };
  const char = CHARACTERS.find((c) => c.unlockLevel === level);
  return { level, charId: char ? char.id : null };
}
