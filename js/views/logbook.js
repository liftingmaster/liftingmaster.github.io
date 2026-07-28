import { renderNav } from '../app.js';
import { dailyBestSeries, personalBestDates, recordedDates } from '../core/stats.js';
import { lineChartSvg } from '../svg/chart.js';
import { editRecord, deleteRecord, displayName } from '../core/player.js';
import { parseCountInput } from './recordInput.js';
import { requirePassword } from './passwordGate.js';
import { renderEvolutionCard } from './evolutionEffect.js';

export function register(app) {
  app.registerScreen('logbook', render);
}

function pad(n) { return String(n).padStart(2, '0'); }

/** ISO文字列（UTC）を端末のローカル時刻の 'HH:MM' にする */
function localTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
        detail.appendChild(recordRow(root, app, player, current, r));
      }
    }
  }
}

/**
 * 日別詳細の1行。「なおす／けす」は承認画面（js/views/approval.js）の
 * 承認待ち行と同じ見た目・同じ操作感（prompt / confirm）にそろえる。
 *
 * 修正前の回数（originalCount）はデータとしては残すが、子供の画面には出さない
 * （仕様 §2.4・§2.5 の 2026-07-27 決定）。
 */
function recordRow(root, app, player, current, r) {
  const row = document.createElement('div');
  row.style.borderTop = '1px solid #eef1f6';
  row.style.padding = '10px 0';
  const time = localTime(r.createdAt);
  row.innerHTML = `
    <div class="row-between">
      <span>${r.mode === 'no' ? 'ノーバウンド' : 'ワンバウンド'}</span>
      <span><b>${r.count}かい</b> <span class="muted">${time}</span></span>
    </div>`;

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = '8px';

  const fix = document.createElement('button');
  fix.className = 'btn btn-sub';
  fix.style.flex = '1';
  fix.textContent = 'なおす';
  fix.addEventListener('click', () => {
    gate(root, app, player, current, {
      title: 'なおす まえに かくにん',
      note: 'きろくを なおすと レベルも かわります。おうちのひとの パスワードを いれてください。',
      okLabel: 'なおす',
    }, () => askAndEdit(root, app, current, r));
  });

  const del = document.createElement('button');
  del.className = 'btn btn-danger';
  del.style.flex = '1';
  del.textContent = 'けす';
  del.addEventListener('click', () => {
    gate(root, app, player, current, {
      title: 'けす まえに かくにん',
      note: 'この きろくを けします。おうちのひとの パスワードを いれてください。',
      okLabel: 'けす',
    }, () => confirmAndDelete(root, app, current, r));
  });

  actions.append(fix, del);
  row.appendChild(actions);
  return row;
}

/**
 * 承認ONのときだけ おうちのひとの パスワードを通す（承認OFFなら素通し）。
 * せっていの「けす／よみこむ」と同じ js/views/passwordGate.js を使う（仕様 §2.3）
 */
function gate(root, app, player, current, { title, note, okLabel }, run) {
  return requirePassword(root, app, player, {
    screen: 'logbook',
    title,
    note,
    okLabel,
    // フォームを開くと画面ごと差し替わるので、やめたら元の月・レンジ・選択日に戻す
    onCancel: () => app.go('logbook', { ...current }),
  }, run);
}

/** きろく帳の元の状態（月・レンジ・選択日）に戻って、フォームを閉じてよいと返す */
function backToLogbook(app, current) {
  app.go('logbook', { ...current });
  return true;
}

/**
 * 修正・削除を実行する前に、結果を先に見せる（2026-07-28 安部さんの判断）。
 *
 * editRecord / deleteRecord は純粋関数なので、ここでドライラン（＝結果を捨てる前提で
 * 1回だけ呼ぶ）して、レベルがどう動くかを確かめられる。**レベルが下がるときだけ**
 * 確認を出す。下がらないときに毎回ダイアログを出すと、子供のふつうの操作が重くなる。
 *
 * 見るのは直した記録の持ち主だけではない。グループ再計算では**兄弟キャラ**のEXPも
 * 動き、そちらのレベルが大きく下がることがある（実例: ひのこを30→250に直すと、
 * 同じ日の もくも が 510→0・Lv9→Lv1）。result.charChanges の全キャラを見る。
 *
 * 返り値: 「ひのこの レベルが 6 → 2、もくもの レベルが 9 → 1 に さがります。」の1文。
 * どのキャラも下がらないなら null
 */
function levelDropNotice(app, result) {
  const player = app.currentPlayer();
  const drops = (result.charChanges || []).filter((c) => c.levelAfter < c.levelBefore);
  // トップレベル（直した記録の持ち主）が charChanges に載らない場合の保険
  if (result.levelAfter < result.levelBefore && !drops.some((c) => c.charId === result.charId)) {
    drops.unshift({
      charId: result.charId, levelBefore: result.levelBefore, levelAfter: result.levelAfter,
    });
  }
  if (drops.length === 0) return null;
  const parts = drops.map(
    (c) => `${displayName(player, c.charId)}の レベルが ${c.levelBefore} → ${c.levelAfter}`,
  );
  return `${parts.join('、')} に さがります。`;
}

/**
 * 進化を見せるべきキャラを、重複なく集める。
 * 兄弟キャラも進化しうるし（グループ再計算でEXPが伸びる）、削除でも起こる。
 * core は evolvedStages に段階を積んでしまうので、ここで拾い落とすと
 * 「演出を見せないまま絵だけ変わり、二度とその瞬間を見られない」ことになる
 */
function evolutionsOf(result) {
  const list = [];
  const seen = new Set();
  const add = (charId, stageBefore, evolvedTo) => {
    if (!evolvedTo || seen.has(charId)) return;
    seen.add(charId);
    list.push({ charId, stageBefore, evolvedTo });
  };
  add(result.charId, result.stageBefore, result.evolvedTo);
  for (const c of result.charChanges || []) add(c.charId, c.stageBefore, c.evolvedTo);
  return list;
}

/** 「なおす」: パスワード通過後に回数を聞き、ドライランして確認してから実行する */
function askAndEdit(root, app, current, r) {
  const input = prompt('ただしい かいすう（1〜9999）', String(r.count));
  if (input === null) return backToLogbook(app, current);
  const n = parseCountInput(input);
  if (n === null) {
    app.toast('1〜9999の せいすうを いれてください');
    return backToLogbook(app, current);
  }
  if (n === r.count) {
    app.toast('おなじ かいすうだよ');
    return backToLogbook(app, current);
  }

  // ドライラン。返ってきた player は捨てて、確認がとれてから updatePlayer の中で
  // もう一度きれいに適用し直す（副作用のある値を updatePlayer に持ち込まない）
  const preview = editRecord(app.currentPlayer(), { recordId: r.id, count: n, now: app.now() });
  const notice = levelDropNotice(app, preview.result);
  if (notice && !confirm(`${notice}それでも なおしますか？`)) return backToLogbook(app, current);

  return runEdit(root, app, current, r.id, n);
}

/**
 * 「けす」: パスワード通過後にドライランし、確認は1回にまとめる。
 * 承認待ちの削除より強い警告にする（EXPが動いたあとの確定記録で、消したら戻せない）
 */
function confirmAndDelete(root, app, current, r) {
  const preview = deleteRecord(app.currentPlayer(), { recordId: r.id, now: app.now() });
  const notice = levelDropNotice(app, preview.result);
  // レベルが下がるときも、警告を2回続けて出さず1つのダイアログにまとめる
  const message = notice
    ? `${notice}もとに もどせません。それでも けしますか？`
    : 'この きろくを けしますか？ もとに もどせません。';
  if (!confirm(message)) return backToLogbook(app, current);
  return runDelete(root, app, current, r.id);
}

/**
 * 修正でEXPが動いたことをホームに伝えるお知らせ。承認（approved）とは別種別で積み、
 * ホーム側でも合算しない（仕様 §3.3）。積む値は「実際に動いた量」＝ result.expDelta
 */
function withEditedEffect(player, result) {
  const exp = Number(result.expDelta);
  if (!Number.isFinite(exp) || exp === 0) return player;
  return { ...player, pendingEffects: [...player.pendingEffects, { type: 'edited', exp }] };
}

function runEdit(root, app, current, recordId, count) {
  let outcome = null;
  const saved = app.updatePlayer((p) => {
    const { player: next, result } = editRecord(p, { recordId, count, now: app.now() });
    outcome = result;
    return withEditedEffect(next, result);
  });
  // 保存できなかったときは updatePlayer 自身が「ほぞんできませんでした」を出し、
  // メモリ上も元に戻している。なおしたと嘘をつかない
  if (!saved) return false;

  return finish(root, app, current, outcome, {
    toastLabel: 'なおしました', heading: 'きろくを なおしたよ',
  });
}

function runDelete(root, app, current, recordId) {
  let outcome = null;
  const saved = app.updatePlayer((p) => {
    const { player: next, result } = deleteRecord(p, { recordId, now: app.now() });
    outcome = result;
    return withEditedEffect(next, result);
  });
  if (!saved) return false;
  return finish(root, app, current, outcome, {
    toastLabel: 'けしました', heading: 'きろくを けしたよ',
  });
}

/**
 * 保存できたあとの締め。進化があれば演出を出し、なければトーストして戻る。
 * 「けす」でも兄弟キャラが進化しうるので、削除もこの経路を通す。
 * 見出しは操作ごとに変える（削除なのに「なおしたよ」と出さない）
 */
function finish(root, app, current, outcome, { toastLabel, heading }) {
  const evolutions = evolutionsOf(outcome);
  if (evolutions.length > 0) {
    showEvolutions(root, app, current, evolutions, heading, outcome);
    return true;
  }
  app.toast(expToast(toastLabel, outcome.expDelta));
  app.go('logbook', { ...current });
  return true;
}

/** EXPがどれだけ動いたか。動いていなければ null */
function expChangeText(expDelta) {
  if (expDelta > 0) return `+${expDelta} EXP`;
  if (expDelta < 0) return `EXPが ${-expDelta} へったよ`;
  return null;
}

function expToast(label, expDelta) {
  const change = expChangeText(expDelta);
  return change ? `${label}（${change}）` : label;
}

/**
 * 「だれの」EXPがどれだけ動いたかの1行。動いていなければ null。
 *
 * 名前を必ず添えるのが要点。グループ再計算では複数キャラのEXPが同時に動くので、
 * 名前なしで「EXPが 1800 へったよ」とだけ出すと、その下に別のキャラの進化カードが
 * 並んだときに「そのキャラが1800減ったのに進化した」と読めてしまう
 */
function expLineFor(name, expDelta) {
  if (expDelta > 0) return `${name}は +${expDelta} EXP もらったよ`;
  if (expDelta < 0) return `${name}の EXPが ${-expDelta} へったよ`;
  return null;
}

/** muted の1行を card に足す（ニックネームが入るので textContent で組む） */
function appendMutedLine(card, text) {
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  card.appendChild(p);
}

/**
 * 修正・削除で新しい進化に到達したときの、その場の演出（仕様 §2.2.3）。
 * 画面遷移（SCREENS への追加）はせず、party.js の openActions と同じく
 * その場で #app を描き替え、.nav の後片付けを自分でやる。
 *
 * 2体以上が同時に進化しても**1枚にまとめて縦に並べる**。ページ送りにすると、
 * 2体目を見る前に下のナビを触られた時点でその演出は二度と出ない
 * （EXPも evolvedStages も保存済みで、displayStageOf が絵だけ進めてしまう）。
 * 「つづける」で、直す前と同じ月・レンジ・選択日の きろく帳に戻る
 *
 * EXPの増減は**キャラごとに、名前をつけて**出す。1つの総括表示にまとめると、
 * 「ひのこが1800へった／しずくが進化した」場面で「しずくが1800へったのに進化した」と
 * 読めてしまう（EXPの計算は正しいのに表示だけで誤解を生む）
 */
function showEvolutions(root, app, current, list, heading, outcome) {
  const player = app.currentPlayer();
  const card = document.createElement('div');
  card.className = 'card center';
  // heading は画面側が持っている固定文だけなので、そのまま入れてよい
  card.innerHTML = `<h1>${heading}</h1>`;

  // キャラID -> このそうさで動いたEXP
  const moved = new Map((outcome.charChanges || []).map((c) => [c.charId, c.expDelta]));
  if (!moved.has(outcome.charId)) moved.set(outcome.charId, outcome.expDelta);
  const evolvedIds = new Set(list.map((item) => item.charId));

  // 進化はしなかったが EXP が動いたキャラを、先に名前つきで伝える
  for (const [charId, delta] of moved) {
    if (evolvedIds.has(charId)) continue;
    appendMutedLine(card, expLineFor(displayName(player, charId), delta));
  }

  // 「進化まえの姿」は core が実際に見ていた段階（stageBefore）を使う。
  // evolvedTo - 1 で代用すると、0→2 に一気に上がったときに「見たことのない
  // 第1進化の姿から変わった」という嘘の絵になる
  // 2体以上を1枚に並べるときは縮小版にする。ふつうの寸法のままだと
  // 「つづける」が画面の外へ出て、スクロールに気づかないと押せなくなる
  const compact = list.length > 1;
  for (const item of list) {
    const name = displayName(player, item.charId);
    card.appendChild(renderEvolutionCard(
      item.charId, item.stageBefore, item.evolvedTo, name, { compact },
    ));
    // 進化カードの直下に、そのキャラ自身のEXP増減を必ず1行添える。
    // EXPが動かずに進化することもある（進化の条件はEXPだけでなく回数・連続日数でも
    // 決まる）ので、その場合も「かわらなかった」と言い切る。ここを空けると、
    // すぐ上の別キャラの行がこのキャラのものに見えてしまう
    appendMutedLine(
      card,
      expLineFor(name, moved.get(item.charId) || 0) || `${name}の EXPは かわらなかったよ`,
    );
  }

  root.innerHTML = '';
  root.appendChild(card);

  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.textContent = 'つづける';
  ok.addEventListener('click', () => app.go('logbook', { ...current }));
  root.appendChild(ok);

  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav('logbook', app);
  window.scrollTo(0, 0);
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
