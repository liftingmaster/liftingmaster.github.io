/**
 * おうちのひとの パスワードを聞くための、画面またぎの共通部品。
 *
 * もとは js/views/settings.js の中だけにあった openForm / requirePassword を、
 * きろく帳（js/views/logbook.js）の「なおす／けす」からも同じ形で使えるように
 * 切り出したもの（仕様 §3.4）。挙動は settings.js にあったときと同じ。
 *
 * これは画面（app.registerScreen で登録するもの）ではなく、呼ばれた画面の上に
 * その場でフォームを描き替える部品なので、js/views/README.md の後片付けの約束
 * （#app の外に足した .nav は自分で始末する）をこちら側で守っている。
 */
import { renderNav } from '../app.js';
import { verifyText } from '../crypto.js';
import { escapeHtml } from './playerSelect.js';

// 承認画面（js/views/approval.js）のパスワード入力と同じ見た目にそろえる
const INPUT_STYLE = 'width:100%;min-height:60px;font-size:22px;padding:0 14px;'
  + 'border:2px solid #d8e0ec;border-radius:14px;font-family:inherit;margin-top:6px';

/**
 * 呼び出し元の画面を、入力フォーム1枚に差し替える（party.js の openActions と
 * 同じ考え方で、app.render() を通らないぶんの後片付け＝古い .nav の削除と
 * スクロールを自分でやる）。
 *
 * prompt() を使わないのは、入力中の文字がそのまま画面に出てしまうため。
 * パスワードと あいことばの こたえ は <input type="password"> で受ける
 * （あいことばの しつもん は秘密ではないので ふつうの text）。
 *
 * screen: 下部ナビでどのタブを光らせるか。「やめる」の戻り先の既定でもある
 * fields: [{ key, label, type }]
 * onCancel: 「やめる」を押したときの戻り先（省略時は app.go(screen)）
 * onSubmit(values): true を返したらフォームを閉じてよい（false なら開いたまま）
 */
export function openForm(root, app, {
  screen = 'settings', title, note, fields, okLabel = 'けってい',
  extraLabel = null, onExtra = null, onCancel = null, onSubmit,
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
  cancel.addEventListener('click', () => (onCancel ? onCancel() : app.go(screen)));
  card.appendChild(cancel);

  root.innerHTML = '';
  root.appendChild(card);
  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav(screen, app);
  window.scrollTo(0, 0);
  const first = inputs[fields[0].key];
  if (first) first.focus();
}

/**
 * 取り返しのつかない操作の前に、おうちのひとの パスワードを聞く。
 * 承認がOFFのときは確かめるパスワードそのものが無いので、今までどおり素通しする。
 * run() は「フォームを閉じてよいか」を true/false で返す。
 */
export function requirePassword(root, app, player, {
  screen = 'settings', title, note, okLabel, onCancel = null,
}, run) {
  if (!player.settings.approvalEnabled) return run();
  return openForm(root, app, {
    screen,
    title,
    note,
    okLabel,
    onCancel,
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
