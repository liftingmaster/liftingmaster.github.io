import { CHARACTERS, STARTER_IDS } from './characters.js';

export const UNLOCK_LEVELS = [10, 20, 30, 40, 50, 65, 80, 100];

/** Lv10 と Lv20 は御三家の残りから、それ以外は unlockLevel が一致するキャラ */
function candidatesFor(level, ownedIds) {
  const owned = new Set(ownedIds);
  const ownedStarters = STARTER_IDS.filter((id) => owned.has(id)).length;

  if (level === 10) {
    if (ownedStarters >= 2) return []; // Already have 2+ starters, Lv10 is done
    return STARTER_IDS.filter((id) => !owned.has(id));
  }

  if (level === 20) {
    if (ownedStarters >= 3) return []; // Already have all 3 starters, Lv20 is done
    return STARTER_IDS.filter((id) => !owned.has(id));
  }

  return CHARACTERS.filter((c) => c.unlockLevel === level && !owned.has(c.id)).map((c) => c.id);
}

/** まだ受け取っていない解放を古い順に返す */
export function pendingUnlocks(maxLevelEver, ownedIds) {
  const result = [];
  for (const level of UNLOCK_LEVELS) {
    if (maxLevelEver < level) break;
    const choices = candidatesFor(level, ownedIds);
    if (choices.length > 0) result.push({ level, choices });
  }
  return result;
}

/** 次に解放されるものの予告。御三家からの選択は charId が null */
export function nextUnlock(maxLevelEver) {
  const level = UNLOCK_LEVELS.find((l) => l > maxLevelEver);
  if (level === undefined) return null;
  if (level === 10 || level === 20) return { level, charId: null };
  const char = CHARACTERS.find((c) => c.unlockLevel === level);
  return { level, charId: char ? char.id : null };
}
