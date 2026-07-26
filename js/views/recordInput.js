import { addRecord, playerView } from '../core/player.js';
import { dailyBest } from '../core/stats.js';

export function register(app) {
  app.registerScreen('recordInput', render);
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** 'YYYY-MM-DD' を delta 日ずらす（UTCで計算するのでDSTの影響を受けない） */
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 'YYYY-MM-DD' の年だけ delta 年ずらす（月日はそのまま。UTCで計算） */
function addYears(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y + delta, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 'YYYY-MM-DD' を「7がつ20にち」の形にする */
export function formatJaDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}がつ${d}にち`;
}

/** 選べる日付の範囲（1年前〜今日）。文字列比較でそのまま境界判定に使える */
export function dateBounds(today) {
  return { min: addYears(today, -1), max: today };
}

/** 範囲外・未選択なら理由（ひらがな文）を返す。問題なければ null */
export function dateOutOfRangeReason(date, today) {
  if (!date) return 'ひづけを えらんでね';
  const { min, max } = dateBounds(today);
  if (date > max) return 'みらいの ひは えらべないよ';
  if (date < min) return '1ねんより まえは えらべないよ';
  return null;
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const today = app.today();
  const yesterday = addDays(today, -1);
  const { min, max } = dateBounds(today);

  let mode = 'no';
  let digits = '';
  let selectedDate = today;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn" id="dateToday" style="flex:1">きょう</button>
      <button class="btn btn-sub" id="dateYesterday" style="flex:1">きのう</button>
    </div>
    <input type="date" id="datePick" class="date-input" value="${today}" min="${min}" max="${max}">
    <div id="dateBanner"></div>
    <div id="dateError" class="muted" style="color:var(--danger);min-height:18px;margin-top:6px"></div>
    <h1 style="margin-top:10px">なんかい できた？</h1>
    <div id="bestInfo" class="muted" style="margin-bottom:10px"></div>
    <div class="row" style="margin-bottom:14px">
      <button class="btn" id="modeNo" style="flex:1">ノーバウンド</button>
      <button class="btn btn-sub" id="modeOne" style="flex:1">ワンバウンド</button>
    </div>
    <div class="center" style="font-size:64px;font-weight:bold;min-height:80px" id="display">0</div>
    <div class="keypad" id="pad"></div>
    <button class="btn btn-lg" id="save" style="margin-top:16px" disabled>これで きろくする</button>
    <button class="btn btn-sub btn-lg" id="cancel" style="margin-top:10px">やめる</button>
  `;
  root.appendChild(card);

  const display = card.querySelector('#display');
  const saveBtn = card.querySelector('#save');
  const modeNo = card.querySelector('#modeNo');
  const modeOne = card.querySelector('#modeOne');
  const dateTodayBtn = card.querySelector('#dateToday');
  const dateYesterdayBtn = card.querySelector('#dateYesterday');
  const datePick = card.querySelector('#datePick');
  const dateBanner = card.querySelector('#dateBanner');
  const dateError = card.querySelector('#dateError');
  const bestInfo = card.querySelector('#bestInfo');

  function currentDateReason() {
    return dateOutOfRangeReason(selectedDate, today);
  }

  function updateBestInfo() {
    const best = dailyBest(player.records, selectedDate, mode);
    const label = selectedDate === today ? 'きょうの' : `${formatJaDate(selectedDate)}の`;
    bestInfo.textContent = best > 0 ? `${label} ベストは ${best}かい` : 'まだ きろくが ないよ';
  }

  function updateDateUI() {
    dateTodayBtn.className = selectedDate === today ? 'btn' : 'btn btn-sub';
    dateYesterdayBtn.className = selectedDate === yesterday ? 'btn' : 'btn btn-sub';
    datePick.value = selectedDate;

    // 今日以外を選んでいるときは、「きょうのつもりで過去日に記録してしまう」
    // 事故を防ぐため、対象日を目立つ形で出す
    dateBanner.innerHTML = selectedDate === today
      ? ''
      : `<div class="date-banner">${formatJaDate(selectedDate)}の きろくを つけるよ</div>`;

    dateError.textContent = currentDateReason() || '';

    updateBestInfo();
    updateSaveEnabled();
  }

  function setMode(next) {
    mode = next;
    modeNo.className = next === 'no' ? 'btn' : 'btn btn-sub';
    modeOne.className = next === 'one' ? 'btn' : 'btn btn-sub';
    updateBestInfo();
  }
  modeNo.addEventListener('click', () => setMode('no'));
  modeOne.addEventListener('click', () => setMode('one'));

  dateTodayBtn.addEventListener('click', () => { selectedDate = today; updateDateUI(); });
  dateYesterdayBtn.addEventListener('click', () => { selectedDate = yesterday; updateDateUI(); });
  datePick.addEventListener('change', () => {
    // 属性の min/max はUIの補助でしかないので、値そのものを毎回検査し直す
    selectedDate = datePick.value;
    updateDateUI();
  });

  const padEl = card.querySelector('#pad');
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'けす', '0', '']) {
    if (key === '') { padEl.appendChild(document.createElement('div')); continue; }
    const b = document.createElement('button');
    b.className = 'btn btn-sub';
    b.textContent = key;
    b.addEventListener('click', () => {
      if (key === 'けす') digits = digits.slice(0, -1);
      else if (digits.length < 4) digits = (digits + key).replace(/^0+/, '');
      update();
    });
    padEl.appendChild(b);
  }

  function update() {
    const n = Number(digits || '0');
    display.textContent = String(n);
    updateSaveEnabled();
  }

  function updateSaveEnabled() {
    const n = Number(digits || '0');
    const digitsValid = Number.isInteger(n) && n >= 1 && n <= 9999;
    saveBtn.disabled = !(digitsValid && !currentDateReason());
  }

  card.querySelector('#cancel').addEventListener('click', () => app.go('home'));

  let saving = false;
  saveBtn.addEventListener('click', () => {
    // 子どもは同じボタンを続けて叩く。画面が切り替わる前の2回目で
    // 二重に記録されないよう、最初の1回で締め切る
    if (saving) return;
    const count = Number(digits);
    if (!(count >= 1 && count <= 9999)) return;
    // ボタンは無効化されているはずだが、属性だけに頼らないという方針を
    // 保存の入口でも徹底する（日付側の最終防波堤）
    if (currentDateReason()) return;
    saving = true;
    saveBtn.disabled = true;

    // 進化アニメーションには「更新前の段階」が要る。addRecord で player が
    // 上書きされる前に、今の段階を playerView で取っておく
    const before = playerView(player, app.today());
    // 結果画面で「何回を超えればよかったか」を出すため、記録前のその日のベストも控えておく
    const oldDailyBest = dailyBest(player.records, selectedDate, mode);
    let outcome = null;
    const saved = app.updatePlayer((p) => {
      const { player: next, result } = addRecord(p, {
        id: app.newId('r'), count, mode, date: selectedDate, now: app.now(),
      });
      outcome = result;
      return next;
    });

    // 保存できなかったときに結果画面へ進むと、「+30 EXP」「レベルアップ」「進化」まで
    // 見せてしまうのに記録はどこにも残っていない。updatePlayer はメモリ上も元に戻して
    // いるので、ここは祝わずに入力画面へ留まり、もう一度押せるようにする。
    // 「ほぞんできませんでした」は app.persist() が出しているので二重に出さない
    if (!saved) {
      saving = false;
      saveBtn.disabled = false;
      return;
    }

    app.go('result', {
      result: outcome, charId: before.charId, stageBefore: before.stage, count, mode,
      date: selectedDate, oldDailyBest,
    });
  });

  setMode('no');
  updateDateUI();
  update();
}
