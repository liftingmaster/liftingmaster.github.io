import { addRecord, playerView } from '../core/player.js';

export function register(app) {
  app.registerScreen('recordInput', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  let mode = 'no';
  let digits = '';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>なんかい できた？</h1>
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

  function setMode(next) {
    mode = next;
    modeNo.className = next === 'no' ? 'btn' : 'btn btn-sub';
    modeOne.className = next === 'one' ? 'btn' : 'btn btn-sub';
  }
  modeNo.addEventListener('click', () => setMode('no'));
  modeOne.addEventListener('click', () => setMode('one'));

  const pad = card.querySelector('#pad');
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'けす', '0', '']) {
    if (key === '') { pad.appendChild(document.createElement('div')); continue; }
    const b = document.createElement('button');
    b.className = 'btn btn-sub';
    b.textContent = key;
    b.addEventListener('click', () => {
      if (key === 'けす') digits = digits.slice(0, -1);
      else if (digits.length < 4) digits = (digits + key).replace(/^0+/, '');
      update();
    });
    pad.appendChild(b);
  }

  function update() {
    const n = Number(digits || '0');
    display.textContent = String(n);
    saveBtn.disabled = !(Number.isInteger(n) && n >= 1 && n <= 9999);
  }

  card.querySelector('#cancel').addEventListener('click', () => app.go('home'));

  let saving = false;
  saveBtn.addEventListener('click', () => {
    // 子どもは同じボタンを続けて叩く。画面が切り替わる前の2回目で
    // 二重に記録されないよう、最初の1回で締め切る
    if (saving) return;
    const count = Number(digits);
    if (!(count >= 1 && count <= 9999)) return;
    saving = true;
    saveBtn.disabled = true;

    // 進化アニメーションには「更新前の段階」が要る。addRecord で player が
    // 上書きされる前に、今の段階を playerView で取っておく
    const before = playerView(player, app.today());
    let outcome = null;
    const saved = app.updatePlayer((p) => {
      const { player: next, result } = addRecord(p, {
        id: app.newId('r'), count, mode, date: app.today(), now: app.now(),
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
    });
  });

  setMode('no');
  update();
}
