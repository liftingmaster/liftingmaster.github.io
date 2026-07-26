import { verifyText } from '../crypto.js';
import { approvePending, rejectPending } from '../core/player.js';

export function register(app) {
  app.registerScreen('approval', render);
}

// パスワード認証はこの画面を開いている間だけ有効（画面を離れると再入力）
let unlocked = false;

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  if (!player.settings.approvalEnabled) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2>かくにんは OFFです</h2><p class="muted">せっていから ONに できます。</p>';
    root.appendChild(card);
    appendBack(root, app);
    return;
  }

  if (!unlocked && !params.unlocked) return renderLock(root, app, player);
  unlocked = true;
  renderList(root, app, player);
}

function renderLock(root, app, player) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>おうちのひと かくにん</h1>
    <p class="muted">パスワードを いれてください</p>
    <input id="pw" type="password" inputmode="text"
      style="width:100%;min-height:60px;font-size:22px;padding:0 14px;border:2px solid #d8e0ec;border-radius:14px;font-family:inherit">
    <button class="btn btn-lg" id="ok" style="margin-top:14px">かくにんする</button>
  `;
  root.appendChild(card);
  appendBack(root, app);

  const submit = async () => {
    const value = card.querySelector('#pw').value;
    const s = player.settings;
    if (await verifyText(s.passwordSalt, s.passwordHash, value)) {
      unlocked = true;
      app.go('approval', { unlocked: true });
    } else {
      app.toast('パスワードが ちがいます');
    }
  };
  card.querySelector('#ok').addEventListener('click', submit);
  card.querySelector('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

/**
 * pendingEffects に積む1件。ホーム画面がここを合計して innerHTML に差し込むため
 * （(e.exp || 0) の形で足し合わせる）、count/exp が非数値だと文字列結合や NaN が
 * そのまま画面に出てしまう。作る場所であるここで確実に有限の数値にしておく。
 */
function approvedEffect(count, exp) {
  const c = Number(count);
  const e = Number(exp);
  return {
    type: 'approved',
    count: Number.isFinite(c) ? c : 0,
    exp: Number.isFinite(e) ? e : 0,
  };
}

function renderList(root, app, player) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h1>しょうにん まち</h1>
    <p class="muted">${player.pending.length}けん</p>`;

  if (player.pending.length === 0) {
    card.innerHTML += '<p>ぜんぶ かくにん ずみです。</p>';
  }

  const sorted = [...player.pending].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  for (const q of sorted) {
    const row = document.createElement('div');
    row.style.borderTop = '1px solid #eef1f6';
    row.style.padding = '12px 0';
    row.innerHTML = `
      <div class="row-between">
        <span>${q.date} ${q.createdAt.slice(11, 16)}</span>
        <b>${q.mode === 'no' ? 'ノーバウンド' : 'ワンバウンド'} ${q.count}かい</b>
      </div>`;

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.marginTop = '8px';

    const ok = document.createElement('button');
    ok.className = 'btn';
    ok.style.flex = '1';
    ok.textContent = 'みとめる';
    ok.addEventListener('click', () => approveOne(app, q.id, q.count));

    const fix = document.createElement('button');
    fix.className = 'btn btn-sub';
    fix.style.flex = '1';
    fix.textContent = 'なおす';
    fix.addEventListener('click', () => {
      const input = prompt('ただしい かいすう（1〜9999）', String(q.count));
      if (input === null) return;
      const n = Number(input);
      if (!Number.isInteger(n) || n < 1 || n > 9999) return app.toast('1〜9999の せいすうを いれてください');
      approveOne(app, q.id, n);
    });

    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.style.flex = '1';
    del.textContent = 'けす';
    del.addEventListener('click', () => {
      if (!confirm('この きろくを けしますか？')) return;
      const saved = app.updatePlayer((p) => rejectPending(p, q.id));
      // 保存できなかったときは updatePlayer 自身が「ほぞんできませんでした」を出し、
      // メモリ上も元に戻す。消えたと嘘をつかないよう、失敗時は再描画しない
      if (!saved) return;
      app.go('approval', { unlocked: true });
    });

    actions.append(ok, fix, del);
    row.appendChild(actions);
    card.appendChild(row);
  }

  root.appendChild(card);

  if (player.pending.length > 1) {
    const all = document.createElement('button');
    all.className = 'btn btn-lg';
    all.textContent = 'ぜんぶ みとめる';
    all.addEventListener('click', () => {
      if (!confirm(`${player.pending.length}けん すべてを みとめますか？`)) return;
      let totalExp = 0;
      let count = 0;
      const saved = app.updatePlayer((p) => {
        let cur = p;
        const ordered = [...cur.pending].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        for (const q of ordered) {
          const { player: next, result } = approvePending(cur, { pendingId: q.id, count: q.count, now: app.now() });
          cur = next;
          totalExp += result.exp;
          count += 1;
        }
        return { ...cur, pendingEffects: [...cur.pendingEffects, approvedEffect(count, totalExp)] };
      });
      // 保存できなかったときは成功したと言わない（updatePlayer がメモリも元に戻している）
      if (!saved) return;
      app.toast(`${count}けん みとめました`);
      app.go('approval', { unlocked: true });
    });
    root.appendChild(all);
  }

  appendBack(root, app);
}

function approveOne(app, pendingId, count) {
  let gained = 0;
  const saved = app.updatePlayer((p) => {
    const { player: next, result } = approvePending(p, { pendingId, count, now: app.now() });
    gained = result.exp;
    return { ...next, pendingEffects: [...next.pendingEffects, approvedEffect(1, result.exp)] };
  });
  // 保存できなかったときは「みとめました」と言わない（updatePlayer がメモリも元に戻している）
  if (!saved) return;
  app.toast(`みとめました（+${gained} EXP）`);
  app.go('approval', { unlocked: true });
}

function appendBack(root, app) {
  const back = document.createElement('button');
  back.className = 'btn btn-sub btn-lg';
  back.style.marginTop = '10px';
  back.textContent = 'ホームに もどる';
  back.addEventListener('click', () => {
    unlocked = false;
    app.go('home');
  });
  root.appendChild(back);
}
