import { renderNav } from '../app.js';
import { dailyBestSeries, personalBestDates, recordedDates } from '../core/stats.js';
import { lineChartSvg } from '../svg/chart.js';

export function register(app) {
  app.registerScreen('logbook', render);
}

function pad(n) { return String(n).padStart(2, '0'); }

/** 'YYYY-MM' を1つ進める／戻す */
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** その日から range 日前までに絞る */
function filterByRange(points, today, range) {
  if (!range) return points;
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - range + 1));
  const fromStr = `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-${pad(from.getUTCDate())}`;
  return points.filter((p) => p.date >= fromStr);
}

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const today = app.today();
  const month = params.month || today.slice(0, 7);
  const range = params.range === undefined ? 30 : params.range;
  const day = params.day;
  // 現在表示中の状態。ナビ操作は毎回これを土台にして、変えた項目だけ上書きする
  // （例: レンジタブを押しても月と選択日は保つ）
  const current = { month, range, day };

  renderCalendar(root, app, player, current);
  renderChart(root, app, player, today, current);
  renderNav('logbook', app);
}

function renderCalendar(root, app, player, current) {
  const { month, range, day: selectedDay } = current;
  const dates = new Set(recordedDates(player.records));
  const pbDates = personalBestDates(player.records);
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row-between">
      <button class="btn btn-sub" id="prev">←</button>
      <h2 style="margin:0">${y}ねん ${m}がつ</h2>
      <button class="btn btn-sub" id="next">→</button>
    </div>
    <div class="cal" style="margin-top:12px" id="cal"></div>
    <div id="dayDetail"></div>
  `;
  root.appendChild(card);

  // 月を移動したら、選択中の日はその月に属していたものなので消す。レンジは維持する
  card.querySelector('#prev').addEventListener('click', () => app.go('logbook', { ...current, month: shiftMonth(month, -1), day: undefined }));
  card.querySelector('#next').addEventListener('click', () => app.go('logbook', { ...current, month: shiftMonth(month, 1), day: undefined }));

  const cal = card.querySelector('#cal');
  for (const w of ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど']) {
    const h = document.createElement('div');
    h.className = 'muted center';
    h.style.fontSize = '12px';
    h.textContent = w;
    cal.appendChild(h);
  }
  for (let i = 0; i < firstWeekday; i += 1) {
    const empty = document.createElement('div');
    empty.className = 'day empty';
    cal.appendChild(empty);
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const cell = document.createElement('div');
    cell.className = 'day';
    cell.style.cursor = 'pointer';
    if (date === selectedDay) cell.style.outline = '2px solid var(--accent)';
    const mark = pbDates.has(date) ? '★' : (dates.has(date) ? '<span class="dot"></span>' : '');
    cell.innerHTML = `<div>${d}</div>${mark}`;
    // 日をタップしたら月とレンジは維持する
    cell.addEventListener('click', () => app.go('logbook', { ...current, day: date }));
    cal.appendChild(cell);
  }

  if (selectedDay) {
    const list = player.records
      .filter((r) => r.date === selectedDay)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const detail = card.querySelector('#dayDetail');
    detail.innerHTML = `<h3 style="margin-top:16px">${selectedDay}</h3>`;
    if (list.length === 0) {
      detail.innerHTML += '<p class="muted">この ひは きろくが ないよ</p>';
    } else {
      for (const r of list) {
        const line = document.createElement('div');
        line.className = 'row-between';
        line.style.padding = '6px 0';
        const time = r.createdAt.slice(11, 16);
        line.innerHTML = `<span>${r.mode === 'no' ? 'ノーバウンド' : 'ワンバウンド'}</span>
          <span><b>${r.count}かい</b> <span class="muted">${time}</span></span>`;
        detail.appendChild(line);
      }
    }
  }
}

function renderChart(root, app, player, today, current) {
  const { range } = current;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>せいちょう グラフ</h2>';

  const tabs = document.createElement('div');
  tabs.className = 'row';
  tabs.style.marginBottom = '12px';
  for (const [label, value] of [['30にち', 30], ['90にち', 90], ['ぜんぶ', 0]]) {
    const b = document.createElement('button');
    b.className = value === range ? 'btn' : 'btn btn-sub';
    b.style.flex = '1';
    b.textContent = label;
    // レンジを切り替えても月と選択中の日は維持する
    b.addEventListener('click', () => app.go('logbook', { ...current, range: value }));
    tabs.appendChild(b);
  }
  card.appendChild(tabs);

  const series = [
    { mode: 'no', color: '#4a90d9', points: filterByRange(dailyBestSeries(player.records, 'no'), today, range) },
    { mode: 'one', color: '#e8a33d', points: filterByRange(dailyBestSeries(player.records, 'one'), today, range) },
  ];

  const holder = document.createElement('div');
  holder.style.overflowX = 'auto';
  holder.innerHTML = lineChartSvg(series, { width: 640, height: 260 });
  card.appendChild(holder);

  const legend = document.createElement('div');
  legend.className = 'row';
  legend.style.justifyContent = 'center';
  legend.style.marginTop = '8px';
  legend.innerHTML = `
    <span style="color:#4a90d9">■ ノーバウンド</span>
    <span style="color:#e8a33d">■ ワンバウンド</span>`;
  card.appendChild(legend);

  root.appendChild(card);
}
