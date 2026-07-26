const PAD = { top: 16, right: 16, bottom: 28, left: 36 };
// ギャップがこれ以上あると polyline が分かれる。ほとんどの子は毎日練習しないので、
// 欠落ごとに分けると点が散るだけ。7日以上の長い中断は可視化する。
const GAP_BREAK_DAYS = 7;

function toDayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function emptyChart(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="16" fill="#888">まだ きろくが ないよ</text>
</svg>`;
}

/**
 * 日別ベストの折れ線グラフを描く。
 * series = [{ mode, color, points: [{ date, count }] }]
 */
export function lineChartSvg(series, options = {}) {
  const { width = 640, height = 280 } = options;

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return emptyChart(width, height);

  const days = all.map((p) => toDayNumber(p.date));
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const maxCount = Math.max(...all.map((p) => p.count));

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const daySpan = maxDay - minDay || 1;
  const countSpan = maxCount || 1;

  const x = (date) => PAD.left + ((toDayNumber(date) - minDay) / daySpan) * plotW;
  const y = (count) => PAD.top + plotH - (count / countSpan) * plotH;
  const r2 = (n) => Math.round(n * 10) / 10;

  // 横の目盛り（0・中間・最大）
  const gridLines = [0, 0.5, 1].map((ratio) => {
    const value = Math.round(countSpan * ratio);
    const gy = r2(PAD.top + plotH - ratio * plotH);
    return `<line x1="${PAD.left}" y1="${gy}" x2="${width - PAD.right}" y2="${gy}" stroke="#e3e3e8" stroke-width="1"/>
  <text x="${PAD.left - 6}" y="${gy + 4}" text-anchor="end" font-size="11" fill="#999">${value}</text>`;
  }).join('\n  ');

  const body = series.filter((s) => s.points.length > 0).map((s) => {
    const sorted = [...s.points].sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });

    // グループ化: 7日以上の間隔で polyline を分ける
    const runs = [];
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const dayGap = toDayNumber(sorted[i].date) - toDayNumber(sorted[i - 1].date);
      if (dayGap < GAP_BREAK_DAYS) {
        current.push(sorted[i]);
      } else {
        runs.push(current);
        current = [sorted[i]];
      }
    }
    runs.push(current);

    // 各 run について polyline を描く（2点以上のみ）
    const lines = runs
      .filter((run) => run.length >= 2)
      .map((run) => {
        const coords = run.map((p) => `${r2(x(p.date))},${r2(y(p.count))}`);
        return `<polyline points="${coords.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      })
      .join('\n  ');

    // すべての点に circle を描く
    const dots = sorted.map((p) => `<circle cx="${r2(x(p.date))}" cy="${r2(y(p.count))}" r="3.5" fill="${s.color}"/>`).join('\n  ');
    return `${lines}${lines ? '\n  ' : ''}${dots}`;
  }).join('\n  ');

  const firstLabel = series.flatMap((s) => s.points).map((p) => p.date).sort()[0];
  const lastLabel = series.flatMap((s) => s.points).map((p) => p.date).sort().slice(-1)[0];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${gridLines}
  ${body}
  <text x="${PAD.left}" y="${height - 8}" font-size="11" fill="#999">${firstLabel}</text>
  <text x="${width - PAD.right}" y="${height - 8}" text-anchor="end" font-size="11" fill="#999">${lastLabel}</text>
</svg>`;
}
