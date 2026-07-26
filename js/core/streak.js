/** 'YYYY-MM-DD' を1970年からの日数に変換する（UTCで計算するのでDSTの影響を受けない） */
function toDayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function uniqueSortedDays(dates) {
  return [...new Set(dates)].map(toDayNumber).sort((a, b) => a - b);
}

/** 今日または昨日を末尾とする連続日数。2日以上あいていれば 0 */
export function currentStreak(dates, today) {
  const days = uniqueSortedDays(dates);
  if (days.length === 0) return 0;

  const todayNum = toDayNumber(today);
  const last = days[days.length - 1];
  if (todayNum - last > 1) return 0;

  let streak = 1;
  for (let i = days.length - 1; i > 0; i -= 1) {
    if (days[i] - days[i - 1] === 1) streak += 1;
    else break;
  }
  return streak;
}

/** 全期間での最長連続日数 */
export function longestStreak(dates) {
  const days = uniqueSortedDays(dates);
  if (days.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] - days[i - 1] === 1) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}
