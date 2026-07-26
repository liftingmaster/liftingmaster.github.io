/** その日・そのモードの最高回数。記録がなければ 0 */
export function dailyBest(records, date, mode) {
  let best = 0;
  for (const r of records) {
    if (r.date === date && r.mode === mode && r.count > best) best = r.count;
  }
  return best;
}

/** 全期間のそのモードの最高回数。記録がなければ 0 */
export function personalBest(records, mode) {
  let best = 0;
  for (const r of records) {
    if (r.mode === mode && r.count > best) best = r.count;
  }
  return best;
}

/** 記録のある日付を重複なし昇順で返す */
export function recordedDates(records) {
  return [...new Set(records.map((r) => r.date))].sort();
}

/** 日別ベストを日付昇順で返す（記録のない日は含めない） */
export function dailyBestSeries(records, mode) {
  const byDate = new Map();
  for (const r of records) {
    if (r.mode !== mode) continue;
    const cur = byDate.get(r.date) ?? 0;
    if (r.count > cur) byDate.set(r.date, r.count);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}

/** 自己ベストを更新した日の集合（モードを問わず、どちらかが更新された日） */
export function personalBestDates(records) {
  const sorted = [...records].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  const best = { no: 0, one: 0 };
  const dates = new Set();
  for (const r of sorted) {
    if (r.count > best[r.mode]) {
      best[r.mode] = r.count;
      dates.add(r.date);
    }
  }
  return dates;
}
