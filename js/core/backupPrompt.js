/**
 * バックアップを促すべきかどうかの判定。純粋関数（DOM・localStorage・Date.now() に
 * 触れない）。画面はこの結果を使うだけで、ここに書いた以外の判定を作らないこと。
 */

/** 未バックアップ扱いにする猶予日数。これ未満なら節目があっても促さない */
export const BACKUP_QUIET_DAYS = 14;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** レベルが10の倍数をまたいだか（例: 9→10, 28→31 はまたぐ。19→19, 10→11 はまたがない） */
function crossedTenMultiple(levelBefore, levelAfter) {
  if (!Number.isFinite(levelBefore) || !Number.isFinite(levelAfter)) return false;
  return Math.floor(levelAfter / 10) > Math.floor(levelBefore / 10);
}

/**
 * バックアップを促すべきか。
 * milestone: { evolved: boolean, unlocked: boolean, levelBefore: number, levelAfter: number }
 * lastBackupAt: ISO文字列 または null/undefined（未バックアップ）
 * now: ISO文字列
 *
 * 「節目があること」かつ「前回バックアップから BACKUP_QUIET_DAYS 日以上、
 * または一度もバックアップしていないこと」の両方を満たしたときだけ true。
 */
export function shouldSuggestBackup(milestone, lastBackupAt, now) {
  const hasMilestone = !!milestone && (
    milestone.evolved === true
    || milestone.unlocked === true
    || crossedTenMultiple(milestone.levelBefore, milestone.levelAfter)
  );
  if (!hasMilestone) return false;

  if (lastBackupAt === null || lastBackupAt === undefined) return true;

  const lastMs = new Date(lastBackupAt).getTime();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return true; // 壊れた日時は未バックアップ扱い

  return (nowMs - lastMs) >= BACKUP_QUIET_DAYS * ONE_DAY_MS;
}
