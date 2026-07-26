import { levelFromExp } from './exp.js';
import { personalBest, recordedDates } from './stats.js';
import { currentStreak, longestStreak } from './streak.js';
import { evolutionStage, evolutionProgress } from './evolution.js';
import { pendingUnlocks, nextUnlock } from './unlock.js';
import { computeGain } from './gain.js';
import { getCharacter } from './characters.js';

/** 育成中キャラの手持ちエントリ */
export function activeCharEntry(player) {
  const entry = player.chars.find((c) => c.charId === player.activeCharId);
  if (!entry) throw new Error(`activeCharId not in chars: ${player.activeCharId}`);
  return entry;
}

function charEntry(player, charId) {
  const entry = player.chars.find((c) => c.charId === charId);
  if (!entry) throw new Error(`character not owned: ${charId}`);
  return entry;
}

/** これまでに育てたキャラの最高到達レベル */
export function maxLevelEver(player) {
  return player.chars.reduce((max, c) => Math.max(max, levelFromExp(c.exp).level), 1);
}

/** 進化判定に使う実績（プレイヤー本人のもの） */
function achievements(player) {
  return {
    bestNo: personalBest(player.records, 'no'),
    bestOne: personalBest(player.records, 'one'),
    longestStreak: longestStreak(recordedDates(player.records)),
  };
}

/** そのキャラの現在の進化段階 */
export function stageOf(player, charId) {
  const entry = charEntry(player, charId);
  const { level } = levelFromExp(entry.exp);
  return evolutionStage(charId, { level, ...achievements(player) });
}

/** 次の進化への進捗。最終形態なら null */
export function progressOf(player, charId) {
  const stage = stageOf(player, charId);
  if (stage >= 2) return null;
  const entry = charEntry(player, charId);
  const { level } = levelFromExp(entry.exp);
  return evolutionProgress(charId, stage + 1, { level, ...achievements(player) });
}

/** ニックネームがあればそれ、なければキャラの正式名 */
export function displayName(player, charId) {
  const entry = player.chars.find((c) => c.charId === charId);
  return (entry && entry.nickname) || getCharacter(charId).name;
}

/** 画面表示に必要な値をまとめて返す */
export function playerView(player, today) {
  const entry = activeCharEntry(player);
  const lv = levelFromExp(entry.exp);
  const dates = recordedDates(player.records);
  const maxLv = maxLevelEver(player);
  return {
    level: lv.level,
    expIntoLevel: lv.expIntoLevel,
    expToNextLevel: lv.expToNextLevel,
    bestNo: personalBest(player.records, 'no'),
    bestOne: personalBest(player.records, 'one'),
    currentStreak: currentStreak(dates, today),
    longestStreak: longestStreak(dates),
    stage: stageOf(player, entry.charId),
    charId: entry.charId,
    charName: displayName(player, entry.charId),
    pendingCount: player.pending.length,
    maxLevelEver: maxLv,
    nextUnlock: nextUnlock(maxLv),
  };
}

/** 深いコピー（構造が単純なJSONなので構造化複製で足りる） */
function clone(player) {
  return JSON.parse(JSON.stringify(player));
}

/** 確定記録を1件足してEXPを反映する。addRecord と approvePending の共通処理 */
function commitRecord(player, record) {
  const next = clone(player);
  const entry = next.chars.find((c) => c.charId === next.activeCharId);

  const levelBefore = levelFromExp(entry.exp).level;
  const stageBefore = stageOf(next, entry.charId);

  const gain = computeGain({
    records: next.records, record, charId: entry.charId, charExp: entry.exp,
  });

  next.records.push(record);
  entry.exp += gain.exp;

  const levelAfter = levelFromExp(entry.exp).level;
  const stageAfter = stageOf(next, entry.charId);

  let evolvedTo = null;
  if (stageAfter > stageBefore && !entry.evolvedStages.includes(stageAfter)) {
    evolvedTo = stageAfter;
    entry.evolvedStages.push(stageAfter);
  }

  const ownedIds = next.chars.map((c) => c.charId);
  const unlocks = pendingUnlocks(maxLevelEver(next), ownedIds);

  return {
    player: next,
    result: {
      queued: false,
      exp: gain.exp,
      isPersonalBest: gain.isPersonalBest,
      levelBefore, levelAfter, evolvedTo, unlocks,
    },
  };
}

/**
 * 記録を1件追加する。
 * 承認機能ONなら承認待ちに入れるだけでEXPは動かない。
 */
export function addRecord(player, { id, count, mode, date, now }) {
  const record = { id, date, mode, count, createdAt: now };

  if (player.settings.approvalEnabled) {
    const next = clone(player);
    next.pending.push(record);
    const level = levelFromExp(activeCharEntry(next).exp).level;
    const ownedIds = next.chars.map((c) => c.charId);
    return {
      player: next,
      result: {
        queued: true, exp: 0, isPersonalBest: false,
        levelBefore: level,
        levelAfter: level,
        evolvedTo: null,
        unlocks: pendingUnlocks(maxLevelEver(next), ownedIds),
      },
    };
  }

  return commitRecord(player, record);
}

/**
 * 承認待ちを承認する。count を渡すと回数を直して承認できる。
 * 承認時点の育成キャラにEXPが入る。
 */
export function approvePending(player, { pendingId, count, now }) {
  const queued = player.pending.find((q) => q.id === pendingId);
  if (!queued) throw new Error(`pending not found: ${pendingId}`);

  const withoutQueued = clone(player);
  withoutQueued.pending = withoutQueued.pending.filter((q) => q.id !== pendingId);

  const record = { ...queued, count, approvedAt: now };
  return commitRecord(withoutQueued, record);
}

/** 承認待ちを削除する（EXPは動かない） */
export function rejectPending(player, pendingId) {
  const next = clone(player);
  next.pending = next.pending.filter((q) => q.id !== pendingId);
  return next;
}

/** 育成キャラを切り替える */
export function switchChar(player, charId) {
  charEntry(player, charId); // 手持ちになければ例外
  const next = clone(player);
  next.activeCharId = charId;
  return next;
}

/** 新しいキャラを受け取る（育成キャラは変わらない） */
export function claimUnlock(player, charId, now) {
  if (player.chars.some((c) => c.charId === charId)) {
    throw new Error(`already owned: ${charId}`);
  }
  getCharacter(charId); // 未知IDなら例外
  const next = clone(player);
  next.chars.push({ charId, nickname: null, exp: 0, unlockedAt: now, evolvedStages: [] });
  return next;
}

/** ニックネームを設定する（空文字なら解除） */
export function setNickname(player, charId, nickname) {
  charEntry(player, charId);
  const next = clone(player);
  const entry = next.chars.find((c) => c.charId === charId);
  const trimmed = String(nickname || '').trim();
  entry.nickname = trimmed === '' ? null : trimmed.slice(0, 10);
  return next;
}
