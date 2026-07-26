import { renderNav } from '../app.js';
import { makeSalt, hashText, verifyText } from '../crypto.js';
import { exportJson, importJson } from '../storage.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('settings', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  renderApproval(root, app, player);
  renderBackup(root, app);
  renderPlayerAdmin(root, app, player);
  renderNav('settings', app);
}

function renderApproval(root, app, player) {
  const card = document.createElement('div');
  card.className = 'card';
  const on = player.settings.approvalEnabled;
  card.innerHTML = `
    <h2>おうちのひとの かくにん</h2>
    <p class="muted">ONに すると、きろくは いったん「しょうにん まち」に なり、
    おうちのひとが かくにんしてから レベルが あがります。</p>
    <div class="row-between" style="margin-top:12px">
      <b>いまは ${on ? 'ON' : 'OFF'}</b>
      <button class="btn ${on ? 'btn-sub' : ''}" id="toggle">${on ? 'OFFに する' : 'ONに する'}</button>
    </div>
  `;
  root.appendChild(card);

  card.querySelector('#toggle').addEventListener('click', async () => {
    if (!on) await enable(app);
    else await disable(app, player);
  });

  if (on) {
    const go = document.createElement('button');
    go.className = 'btn btn-lg';
    go.style.marginTop = '10px';
    go.textContent = 'しょうにん がめんへ';
    go.addEventListener('click', () => app.go('approval'));
    card.appendChild(go);
  }
}

async function enable(app) {
  const pw = prompt('あたらしい パスワード（4もじいじょう）');
  if (pw === null) return;
  if (String(pw).length < 4) return app.toast('4もじいじょうに してください');

  const pw2 = prompt('もういちど パスワードを いれてください');
  if (pw2 !== pw) return app.toast('パスワードが ちがいます');

  const question = prompt('パスワードを わすれた ときの あいことばの しつもん\n（れい: いちばん すきな たべものは？）');
  if (!question) return app.toast('あいことばの しつもんを いれてください');

  const answer = prompt('その こたえ');
  if (!answer) return app.toast('こたえを いれてください');

  const salt = makeSalt();
  const passwordHash = await hashText(salt, pw);
  const secretAnswerHash = await hashText(salt, answer);

  const saved = app.updatePlayer((p) => ({
    ...p,
    settings: {
      ...p.settings,
      approvalEnabled: true,
      passwordSalt: salt,
      passwordHash,
      secretQuestion: question,
      secretAnswerHash,
    },
  }));
  // 保存に失敗したときは persist() 自身が「ほぞんできませんでした」を出すので、
  // ここでは成功したと嘘をつかない（ONにしたと言わない・画面も動かさない）
  if (!saved) return;
  app.toast('かくにんを ONに しました');
  app.go('settings');
}

async function disable(app, player) {
  const s = player.settings;
  const pw = prompt('パスワードを いれてください\n（わすれた ときは からっぽの まま OK）');
  if (pw === null) return;

  let allowed = false;
  if (pw === '') {
    const answer = prompt(`あいことば: ${s.secretQuestion}`);
    if (answer === null) return;
    allowed = await verifyText(s.passwordSalt, s.secretAnswerHash, answer);
    if (!allowed) return app.toast('あいことばが ちがいます');
  } else {
    allowed = await verifyText(s.passwordSalt, s.passwordHash, pw);
    if (!allowed) return app.toast('パスワードが ちがいます');
  }

  const keep = player.pending.length > 0
    ? confirm(`しょうにん まちが ${player.pending.length}けん あります。\nOK: すべて しょうにんせずに けす\nキャンセル: やめる`)
    : true;
  if (!keep) return;

  const saved = app.updatePlayer((p) => ({
    ...p,
    pending: [],
    settings: {
      ...p.settings,
      approvalEnabled: false,
      passwordHash: null,
      passwordSalt: null,
      secretQuestion: null,
      secretAnswerHash: null,
    },
  }));
  // 保存に失敗したときは persist() 自身が「ほぞんできませんでした」を出すので、
  // ここでは成功したと嘘をつかない（OFFにしたと言わない・画面も動かさない）
  if (!saved) return;
  app.toast('かくにんを OFFに しました');
  app.go('settings');
}

function renderBackup(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>バックアップ</h2>
    <p class="muted">きろくは この たんまつの なかだけに あります。
    ときどき かきだして ほぞんして おくと あんしんです。</p>`;

  const out = document.createElement('button');
  out.className = 'btn btn-lg';
  out.textContent = 'かきだす（ダウンロード）';
  out.addEventListener('click', () => {
    const blob = new Blob([exportJson(app.state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liftingmaster-backup-${app.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  card.appendChild(out);

  const inLabel = document.createElement('label');
  inLabel.className = 'btn btn-sub btn-lg';
  inLabel.style.marginTop = '10px';
  inLabel.textContent = 'よみこむ（ファイルを えらぶ）';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    let text;
    try {
      text = await f.text();
    } catch (e) {
      alert(`ファイルを よめませんでした:\n${e.message || e}`);
      file.value = '';
      return;
    }
    const r = importJson(text);
    if (!r.ok) {
      alert(`よみこめませんでした:\n${r.errors.slice(0, 3).join('\n')}`);
      file.value = '';
      return;
    }
    const ok = confirm('いまの きろくを すべて けして、ファイルの ないように おきかえます。よろしいですか？');
    if (!ok) {
      file.value = '';
      return;
    }
    // 検証済みの内容でも、保存自体が失敗する（容量超過など）ことがある。
    // その場合は今のデータへ戻し、置き換えが半端に残らないようにする。
    const previousState = app.state;
    app.state = r.state;
    if (!app.persist()) {
      app.state = previousState;
      file.value = '';
      return;
    }
    app.toast('よみこみました');
    app.go(app.currentPlayer() ? 'home' : 'playerSelect');
  });
  inLabel.appendChild(file);
  card.appendChild(inLabel);

  root.appendChild(card);
}

function renderPlayerAdmin(root, app, player) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>プレイヤー</h2>
    <p>いま: <b>${escapeHtml(player.name)}</b></p>`;

  const switchBtn = document.createElement('button');
  switchBtn.className = 'btn btn-sub btn-lg';
  switchBtn.textContent = 'べつの ひとに かわる';
  switchBtn.addEventListener('click', () => app.go('playerSelect'));
  card.appendChild(switchBtn);

  const del = document.createElement('button');
  del.className = 'btn btn-danger btn-lg';
  del.style.marginTop = '10px';
  del.textContent = 'この プレイヤーを けす';
  del.addEventListener('click', () => {
    if (!confirm(`${player.name} の きろくを すべて けします。もとに もどせません。`)) return;
    if (!confirm('ほんとうに けしますか？')) return;

    // 保存が失敗したとき、消したつもりのプレイヤーがメモリ上だけ消えたままだと、
    // 別の操作で保存し直したときに「失敗したはずの削除」が生き返って本当に消えてしまう。
    // それを防ぐため、失敗したら削除前の状態にきっちり戻す。
    const previousPlayers = app.state.players;
    const previousActivePlayerId = app.state.activePlayerId;
    app.state.players = app.state.players.filter((p) => p.id !== player.id);
    app.state.activePlayerId = app.state.players.length > 0 ? app.state.players[0].id : null;
    if (!app.persist()) {
      app.state.players = previousPlayers;
      app.state.activePlayerId = previousActivePlayerId;
      return;
    }
    app.go(app.state.activePlayerId ? 'home' : 'playerSelect');
  });
  card.appendChild(del);

  root.appendChild(card);
}
