import { renderNav } from '../app.js';
import { makeSalt, hashText, verifyText } from '../crypto.js';
import { exportJson, importJson } from '../storage.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('settings', render);
}

// 承認画面（js/views/approval.js）のパスワード入力と同じ見た目にそろえる
const INPUT_STYLE = 'width:100%;min-height:60px;font-size:22px;padding:0 14px;'
  + 'border:2px solid #d8e0ec;border-radius:14px;font-family:inherit;margin-top:6px';

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  renderApproval(root, app, player);
  renderBackup(root, app, player);
  renderPlayerAdmin(root, app, player);
  renderNav('settings', app);
}

/**
 * 設定画面を、入力フォーム1枚に差し替える（party.js の openActions と同じ考え方で、
 * app.render() を通らないぶんの後片付け＝古い .nav の削除とスクロールを自分でやる）。
 *
 * prompt() を使わないのは、入力中の文字がそのまま画面に出てしまうため。
 * パスワードと あいことばの こたえ は <input type="password"> で受ける
 * （あいことばの しつもん は秘密ではないので ふつうの text）。
 *
 * fields: [{ key, label, type }]
 * onSubmit(values): true を返したらフォームを閉じてよい（false なら開いたまま）
 */
function openForm(root, app, {
  title, note, fields, okLabel = 'けってい', extraLabel = null, onExtra = null, onSubmit,
}) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${escapeHtml(title)}</h2>`
    + (note ? `<p class="muted">${escapeHtml(note)}</p>` : '');

  const inputs = {};
  for (const f of fields) {
    const label = document.createElement('label');
    label.style.display = 'block';
    label.style.marginTop = '14px';
    label.innerHTML = `<span class="muted">${escapeHtml(f.label)}</span>`;
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.setAttribute('inputmode', 'text');
    input.setAttribute('style', INPUT_STYLE);
    label.appendChild(input);
    card.appendChild(label);
    inputs[f.key] = input;
  }

  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.style.marginTop = '16px';
  ok.textContent = okLabel;

  const submit = async () => {
    // 子どもは同じボタンを続けて叩く。ハッシュ計算は非同期なので、
    // 終わるまでは2回目を受け付けない
    if (ok.disabled) return;
    ok.disabled = true;
    const values = {};
    for (const key of Object.keys(inputs)) values[key] = inputs[key].value;
    let done = false;
    try {
      done = await onSubmit(values);
    } finally {
      if (!done) ok.disabled = false;
    }
  };
  ok.addEventListener('click', submit);
  for (const key of Object.keys(inputs)) {
    inputs[key].addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
  card.appendChild(ok);

  if (extraLabel && onExtra) {
    const extra = document.createElement('button');
    extra.className = 'btn btn-sub btn-lg';
    extra.style.marginTop = '10px';
    extra.textContent = extraLabel;
    extra.addEventListener('click', onExtra);
    card.appendChild(extra);
  }

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-sub btn-lg';
  cancel.style.marginTop = '10px';
  cancel.textContent = 'やめる';
  cancel.addEventListener('click', () => app.go('settings'));
  card.appendChild(cancel);

  root.innerHTML = '';
  root.appendChild(card);
  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav('settings', app);
  window.scrollTo(0, 0);
  const first = inputs[fields[0].key];
  if (first) first.focus();
}

/**
 * 取り返しのつかない操作の前に、おうちのひとの パスワードを聞く。
 * 承認がOFFのときは確かめるパスワードそのものが無いので、今までどおり素通しする。
 * run() は「フォームを閉じてよいか」を true/false で返す。
 */
function requirePassword(root, app, player, { title, note, okLabel }, run) {
  if (!player.settings.approvalEnabled) return run();
  return openForm(root, app, {
    title,
    note,
    okLabel,
    fields: [{ key: 'pw', label: 'パスワード', type: 'password' }],
    onSubmit: async (v) => {
      const s = player.settings;
      if (!await verifyText(s.passwordSalt, s.passwordHash, v.pw)) {
        app.toast('パスワードが ちがいます');
        return false;
      }
      return run();
    },
  });
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

  card.querySelector('#toggle').addEventListener('click', () => {
    if (!on) enable(root, app);
    else disable(root, app, player);
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

function enable(root, app) {
  openForm(root, app, {
    title: 'かくにんを ONに する',
    note: 'パスワードと、わすれた ときの あいことばを きめてください。',
    okLabel: 'ONに する',
    fields: [
      { key: 'pw', label: 'あたらしい パスワード（4もじいじょう）', type: 'password' },
      { key: 'pw2', label: 'もういちど おなじ パスワード', type: 'password' },
      { key: 'question', label: 'あいことばの しつもん（れい: いちばん すきな たべものは？）', type: 'text' },
      { key: 'answer', label: 'その こたえ', type: 'password' },
    ],
    onSubmit: async (v) => {
      if (v.pw.length < 4) { app.toast('4もじいじょうに してください'); return false; }
      if (v.pw !== v.pw2) { app.toast('パスワードが ちがいます'); return false; }
      const question = v.question.trim();
      if (question === '') { app.toast('あいことばの しつもんを いれてください'); return false; }
      if (v.answer === '') { app.toast('こたえを いれてください'); return false; }

      const salt = makeSalt();
      const passwordHash = await hashText(salt, v.pw);
      const secretAnswerHash = await hashText(salt, v.answer);

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
      if (!saved) return false;
      app.toast('かくにんを ONに しました');
      app.go('settings');
      return true;
    },
  });
}

function disable(root, app, player) {
  openForm(root, app, {
    title: 'かくにんを OFFに する',
    note: 'おうちのひとの パスワードを いれてください。',
    okLabel: 'OFFに する',
    fields: [{ key: 'pw', label: 'パスワード', type: 'password' }],
    extraLabel: 'パスワードを わすれた',
    onExtra: () => disableBySecret(root, app, player),
    onSubmit: async (v) => {
      const s = player.settings;
      if (!await verifyText(s.passwordSalt, s.passwordHash, v.pw)) {
        app.toast('パスワードが ちがいます');
        return false;
      }
      return finishDisable(app);
    },
  });
}

function disableBySecret(root, app, player) {
  const s = player.settings;
  openForm(root, app, {
    title: 'あいことばで OFFに する',
    note: s.secretQuestion || 'あいことばの こたえを いれてください。',
    okLabel: 'OFFに する',
    fields: [{ key: 'answer', label: 'こたえ', type: 'password' }],
    onSubmit: async (v) => {
      if (!await verifyText(s.passwordSalt, s.secretAnswerHash, v.answer)) {
        app.toast('あいことばが ちがいます');
        return false;
      }
      return finishDisable(app);
    },
  });
}

function finishDisable(app) {
  const player = app.currentPlayer();
  const keep = player.pending.length > 0
    ? confirm(`しょうにん まちが ${player.pending.length}けん あります。\nOK: すべて しょうにんせずに けす\nキャンセル: やめる`)
    : true;
  if (!keep) return false;

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
  if (!saved) return false;
  app.toast('かくにんを OFFに しました');
  app.go('settings');
  return true;
}

function renderBackup(root, app, player) {
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
    a.style.display = 'none';
    // iOS Safari や一部の Android WebView は、(a) アンカーが文書に付いていない
    // (b) click と同じターンで blob URL を revoke する と、保存を中断して
    // 何も起きない。バックアップは家族にとって唯一のデータ保護なので、
    // 黙って失敗するのが一番まずい。文書に足してから押し、片付けは1秒あとに回す
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
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
    // よみこみは「ぜんいん ぶんの きろく」を置き換える取り返しのつかない操作なので、
    // かくにんが ON のあいだは おうちのひとの パスワードを通す
    requirePassword(root, app, player, {
      title: 'よみこむ まえに かくにん',
      note: 'いまの きろくを ぜんぶ おきかえます。おうちのひとの パスワードを いれてください。',
      okLabel: 'よみこむ',
    }, () => {
      // 検証済みの内容でも、保存自体が失敗する（容量超過など）ことがある。
      // その場合は今のデータへ戻し、置き換えが半端に残らないようにする。
      const previousState = app.state;
      app.state = r.state;
      if (!app.persist()) {
        app.state = previousState;
        return false;
      }
      app.toast('よみこみました');
      app.go(app.currentPlayer() ? 'home' : 'playerSelect');
      return true;
    });
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

    // 何年ぶんもの きろくが 数タップで 消える操作なので、かくにんが ON のあいだは
    // おうちのひとの パスワードを通す（退避は壊れたデータのときしか作られないため、
    // ここで消したものは戻せない）
    requirePassword(root, app, player, {
      title: 'けす まえに かくにん',
      note: `${player.name} の きろくを すべて けします。おうちのひとの パスワードを いれてください。`,
      okLabel: 'けす',
    }, () => {
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
        return false;
      }
      app.go(app.state.activePlayerId ? 'home' : 'playerSelect');
      return true;
    });
  });
  card.appendChild(del);

  root.appendChild(card);
}
