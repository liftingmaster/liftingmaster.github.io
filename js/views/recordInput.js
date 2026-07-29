import { addRecord, stageOf, activeCharEntry } from '../core/player.js';
import { dailyBest } from '../core/stats.js';
import { levelFromExp } from '../core/exp.js';
import { pickDayWinnerMode } from '../core/gain.js';

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

/**
 * prompt() で受け取った「かいすう」を数値にする。範囲外・数字以外なら null。
 *
 * Number() だけに任せると '0x1e' が 30、'1e3' が 1000、' 12 ' が 12 として
 * Number.isInteger を通ってしまう。子供や おうちのひとが打つ想定の値ではないので、
 * 半角数字1〜4桁だけを受け付ける。承認画面（approval.js）ときろく帳（logbook.js）の
 * 両方がこれを使い、2つの画面で判定がずれないようにする
 */
export function parseCountInput(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= 9999 ? n : null;
}

export function modeLabel(mode) {
  return mode === 'no' ? 'ノーバウンド' : 'ワンバウンド';
}

/**
 * その日のEXPを今どのモードが取っているか（EXP頭打ちルール・2026-07-28）。
 * 保存済みの grantedExp を読むだけ。まだ誰もEXPを取っていなければ null
 */
export function dayExpHolder(records, date) {
  const totals = { no: 0, one: 0 };
  for (const r of records) {
    if (r.date !== date) continue;
    if (!Number.isFinite(r.grantedExp)) continue;
    if (totals[r.mode] === undefined) continue;
    totals[r.mode] += r.grantedExp;
  }
  if (totals.no === 0 && totals.one === 0) return null;
  const mode = pickDayWinnerMode(totals);
  return { mode, exp: totals[mode] };
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

  // mode は 'no' | 'one' | 'both'。'both'（りょうほう）のときだけ、同じテンキーを
  // 2段階で使う（1段目=ノーバウンド、2段目=ワンバウンド。仕様 §4.2）。
  // キーパッドを2つ並べる案は不採用
  let mode = 'no';
  let step = 1;
  let noCount = 0;
  let digits = '';
  let selectedDate = today;

  // モードは3択なので、375px幅だと1つあたりの内側は約82px しかない。
  // 「ノーバウンド」6文字は 15px だと 90px になって「ノーバウン／ド」で折り返す。
  // 13px なら 6×13＝78px で収まる（14px は 84px で溢れる）。
  // nowrap を付けて、あとでラベルを変えたときに黙って割れないようにする
  const MODE_BTN_STYLE = 'flex:1;padding:0 6px;font-size:13px;line-height:1.2;white-space:nowrap';

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
    <h1 style="margin-top:10px" id="prompt">なんかい できた？</h1>
    <div id="bestInfo" class="muted"></div>
    <div id="dayExpInfo" class="muted" style="margin-bottom:10px"></div>
    <div class="row" style="margin-bottom:14px">
      <button class="btn" id="modeNo" style="${MODE_BTN_STYLE}">ノーバウンド</button>
      <button class="btn btn-sub" id="modeOne" style="${MODE_BTN_STYLE}">ワンバウンド</button>
      <button class="btn btn-sub" id="modeBoth" style="${MODE_BTN_STYLE}">りょうほう</button>
    </div>
    <div id="stepInfo" class="muted" style="margin-bottom:8px"></div>
    <div class="center" style="font-size:64px;font-weight:bold;min-height:80px" id="display">0</div>
    <div class="keypad" id="pad"></div>
    <button class="btn btn-lg" id="save" style="margin-top:16px" disabled>これで きろくする</button>
    <button class="btn btn-sub btn-lg" id="skipOne" style="margin-top:10px;display:none">ワンバウンドは やらなかった</button>
    <button class="btn btn-sub btn-lg" id="cancel" style="margin-top:10px">やめる</button>
  `;
  root.appendChild(card);

  const display = card.querySelector('#display');
  const saveBtn = card.querySelector('#save');
  const skipOneBtn = card.querySelector('#skipOne');
  const promptEl = card.querySelector('#prompt');
  const stepInfo = card.querySelector('#stepInfo');
  const modeNo = card.querySelector('#modeNo');
  const modeOne = card.querySelector('#modeOne');
  const modeBoth = card.querySelector('#modeBoth');
  const dateTodayBtn = card.querySelector('#dateToday');
  const dateYesterdayBtn = card.querySelector('#dateYesterday');
  const datePick = card.querySelector('#datePick');
  const dateBanner = card.querySelector('#dateBanner');
  const dateError = card.querySelector('#dateError');
  const bestInfo = card.querySelector('#bestInfo');
  const dayExpInfo = card.querySelector('#dayExpInfo');

  function currentDateReason() {
    return dateOutOfRangeReason(selectedDate, today);
  }

  /** いまテンキーで入れている回数が、どちらのモードのものか */
  function inputMode() {
    if (mode !== 'both') return mode;
    return step === 1 ? 'no' : 'one';
  }

  function updateBestInfo() {
    const best = dailyBest(player.records, selectedDate, inputMode());
    const label = selectedDate === today ? 'きょうの' : `${formatJaDate(selectedDate)}の`;
    bestInfo.textContent = best > 0 ? `${label} ベストは ${best}かい` : 'まだ きろくが ないよ';

    // その日のEXPは「いちばん よかった きろく1つぶん」だけ（EXP頭打ちルール）。
    // どのモードで決まっているかが分かると、なぜ +0 EXP になるのかが読める。
    // 承認ONのあいだは grantedExp がまだ無いので、この行は自然に消える
    const holder = dayExpHolder(player.records, selectedDate);
    dayExpInfo.textContent = holder
      ? `${label} EXPは いま ${modeLabel(holder.mode)}の +${holder.exp} EXP`
      : '';
  }

  /** 見出し・保存ボタンの文言・「やらなかった」ボタンを、今の段階に合わせる */
  function updateStepUI() {
    if (mode === 'both') {
      promptEl.textContent = step === 1
        ? 'ノーバウンド なんかい できた？'
        : 'ワンバウンド なんかい できた？';
      // 24px のボタンに入るのは 263px÷24 ≒ 10文字まで。
      // 「つぎ（ワンバウンドを いれる）」は15文字で2行になり、括弧が行をまたいで割れる
      saveBtn.textContent = step === 1 ? 'つぎ ワンバウンド' : 'これで きろくする';
      stepInfo.textContent = step === 2 ? `ノーバウンド ${noCount}かい にゅうりょくずみ` : '';
      skipOneBtn.style.display = step === 2 ? '' : 'none';
    } else {
      promptEl.textContent = 'なんかい できた？';
      saveBtn.textContent = 'これで きろくする';
      stepInfo.textContent = '';
      skipOneBtn.style.display = 'none';
    }
    updateBestInfo();
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
    // モードを選び直したら「りょうほう」の途中経過は捨てる
    step = 1;
    noCount = 0;
    modeNo.className = next === 'no' ? 'btn' : 'btn btn-sub';
    modeOne.className = next === 'one' ? 'btn' : 'btn btn-sub';
    modeBoth.className = next === 'both' ? 'btn' : 'btn btn-sub';
    updateStepUI();
  }
  modeNo.addEventListener('click', () => setMode('no'));
  modeOne.addEventListener('click', () => setMode('one'));
  modeBoth.addEventListener('click', () => setMode('both'));

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

  /**
   * items（[{ mode, count }, …]）を1回のトランザクションで確定する。
   *
   * 「りょうほう」は必ず ノー→ワン の順に固定して連続適用する（仕様 §4.3）。
   * すくすく（Lv20以下）・きらめき（Lv50以上）のようなレベル依存の特性は、
   * 1件目の加算でレベルが跨ぐと2件目の倍率判定が変わるため、適用順で合計EXPが
   * 変わりうる。順序を固定しておけば、UIでどちらを先に入力しても結果が決まる。
   *
   * 保存は app.updatePlayer 1回きり。「ノーだけ保存できてワンが失敗する」半端な
   * 状態を作らない（保存に失敗したら updatePlayer がメモリ上も元に戻す）
   */
  function commit(items) {
    if (saving) return;
    for (const it of items) {
      if (!(it.count >= 1 && it.count <= 9999)) return;
    }
    // ボタンは無効化されているはずだが、属性だけに頼らないという方針を
    // 保存の入口でも徹底する（日付側の最終防波堤）
    if (currentDateReason()) return;
    saving = true;
    saveBtn.disabled = true;

    // 結果画面で「何回を超えればよかったか」を出すため、記録前のその日のベストを控えておく。
    // 日別ベストはモードごとに独立なので、2件同時でも互いに影響しない
    const oldBests = items.map((it) => dailyBest(player.records, selectedDate, it.mode));

    let entries = [];
    const saved = app.updatePlayer((p) => {
      let cur = p;
      const out = [];
      const activeId = cur.activeCharId;
      const levelAtStart = levelFromExp(activeCharEntry(cur).exp).level;
      items.forEach((it, i) => {
        // 進化アニメーションには「その記録を入れる直前の段階」が要る。
        // 2件目は1件目の結果を踏まえた段階になる
        const charId = cur.activeCharId;
        const stageBefore = stageOf(cur, charId);
        const recordId = app.newId('r');
        const { player: next, result } = addRecord(cur, {
          id: recordId, count: it.count, mode: it.mode, date: selectedDate, now: app.now(),
        });
        cur = next;
        out.push({
          result,
          recordId,
          count: it.count,
          mode: it.mode,
          oldDailyBest: oldBests[i],
          charId,
          stageBefore,
        });
      });

      // 【EXP頭打ちルール（2026-07-28）】その日のEXPは「いちばん よかった きろく
      // 1つぶん」だけ。りょうほうで2件入れると、あとの1件が前の1件の grantedExp を
      // 0に引き直すことがある。1件目の result.exp はその時点の値で**もう古い**ので、
      // 確定後の記録から読み直す。これをしないと、けっか画面が 30+60=90 のように
      // 実際より多いEXPを見せてしまう
      const finalWinner = out.length > 0 ? out[out.length - 1].result.dayWinnerMode : null;
      out.forEach((e) => {
        const rec = cur.records.find((r) => r.id === e.recordId);
        e.result = {
          ...e.result,
          exp: rec && Number.isFinite(rec.grantedExp) ? rec.grantedExp : e.result.exp,
          dayWinnerMode: e.result.queued ? null : finalWinner,
        };
      });

      // レベルの前後も、1件ずつの途中経過ではなく取引全体で言い直す。
      // EXPをもらえるのは（りょうほうでもモードが違うので）多くて1件なので、
      // 「レベルアップ！」の帯が2回出ることはない
      if (!out.some((e) => e.result.queued)) {
        const levelAtEnd = levelFromExp(
          cur.chars.find((c) => c.charId === activeId).exp,
        ).level;
        const winnerIndex = out.findIndex((e) => e.result.exp > 0);
        // 誰も +EXP を取らなかった取引（winnerIndex === -1）でも、育成中のキャラ自身の
        // レベルは動きうる（2026-07-29 欠陥B）。さかのぼって記録を足すと、その日の
        // 勝敗が引き直されて**前にもらっていた EXP が取り消される**ためで、
        // 「+0 EXP なのにレベルが下がる」が実際に起きる。ここで levelBefore と
        // levelAfter を levelAtStart で揃えてしまうと、けっか画面が「Lv23 → Lv23」と
        // 嘘をつき、子供は何が起きたのか分からないまま1レベル失う。
        // 変化があるのに帰属先がないときは、**最後のエントリ**に帰属させて必ず言う
        // ⚠️ 罠23: changeIndex は「取引全体で言い直したレベル変化」の帰属先だが、
        // core の charChanges は各キャラ単位で1件ずつ返す。りょうほうで記録2件追加のとき、
        // キャラのレベルが下がってもエントリ0の charChanges に入ることがある。一方で changeIndex は
        // 最後のエントリ（エントリ1）に帰属させている。現在は result.js の benchedLevelDrops が
        // 育成中キャラを除外するので二重表示に至っていないが、将来 logbook.js のような画面に
        // charChanges を引き継いだとき同じキャラが「Lv24→Lv23」と両エントリで言い出す可能性がある
        const changeIndex = winnerIndex >= 0
          ? winnerIndex
          : (levelAtEnd !== levelAtStart ? out.length - 1 : -1);
        out.forEach((e, i) => {
          const before = changeIndex >= 0 && i > changeIndex ? levelAtEnd : levelAtStart;
          const after = changeIndex >= 0 && i >= changeIndex ? levelAtEnd : levelAtStart;
          e.result = { ...e.result, levelBefore: before, levelAfter: after };
        });
      }

      entries = out;
      return cur;
    });

    // 保存できなかったときに結果画面へ進むと、「+30 EXP」「レベルアップ」「進化」まで
    // 見せてしまうのに記録はどこにも残っていない。updatePlayer はメモリ上も元に戻して
    // いるので、ここは祝わずに入力画面へ留まり、もう一度押せるようにする。
    // 「ほぞんできませんでした」は app.persist() が出しているので二重に出さない
    if (!saved) {
      saving = false;
      updateSaveEnabled();
      return;
    }

    app.go('result', { entries, date: selectedDate });
  }

  saveBtn.addEventListener('click', () => {
    // 子どもは同じボタンを続けて叩く。画面が切り替わる前の2回目で
    // 二重に記録されないよう、最初の1回で締め切る
    if (saving) return;
    const count = Number(digits);
    if (!(count >= 1 && count <= 9999)) return;

    // 「りょうほう」の1段目は、まだ保存しない。回数を覚えてテンキーを空にし、
    // 2段目（ワンバウンド）へ進むだけ
    if (mode === 'both' && step === 1) {
      noCount = count;
      step = 2;
      digits = '';
      updateStepUI();
      update();
      return;
    }

    if (mode === 'both') {
      commit([{ mode: 'no', count: noCount }, { mode: 'one', count }]);
      return;
    }
    commit([{ mode, count }]);
  });

  // 2段目で「やっぱりワンバウンドはやっていない」となったら、1段目のノーバウンドだけを
  // 単一モードの記録として保存する（0のままでは記録できない既存ルールはそのまま）
  skipOneBtn.addEventListener('click', () => {
    if (saving) return;
    if (!(noCount >= 1 && noCount <= 9999)) return;
    // すでにワンバウンドの数字を入れたあとに押されたら、黙って捨てない
    const typed = Number(digits || '0');
    if (typed >= 1 && !confirm(`いま いれた ${typed}かいは きえるよ。ノーバウンド ${noCount}かいだけ きろくする？`)) return;
    commit([{ mode: 'no', count: noCount }]);
  });

  setMode('no');
  updateDateUI();
  update();
}
