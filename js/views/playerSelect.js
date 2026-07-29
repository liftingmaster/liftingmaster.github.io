import { createPlayer, importJson } from '../storage.js';
import { STARTER_IDS, getCharacter } from '../core/characters.js';
import { characterSvg } from '../svg/character.js';
import { playerView } from '../core/player.js';

export function register(app) {
  app.registerScreen('playerSelect', render);
}

function render(root, app, params = {}) {
  const hasPlayers = app.state.players.length > 0;
  if (params.mode === 'create' || !hasPlayers) return renderCreate(root, app, hasPlayers);
  return renderList(root, app);
}

function renderList(root, app) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h1>だれが やる？</h1>';

  for (const p of app.state.players) {
    const v = playerView(p, app.today());
    const btn = document.createElement('button');
    btn.className = 'btn btn-sub btn-lg';
    btn.style.marginBottom = '10px';
    btn.style.justifyContent = 'space-between';
    btn.innerHTML = `<span>${escapeHtml(p.name)}</span>
      <span class="muted">${escapeHtml(v.charName)} Lv${v.level}</span>`;
    btn.addEventListener('click', () => {
      app.state.activePlayerId = p.id;
      // 保存できていないのに先へ進むと、次の操作が消える。作成側と同じく止める
      if (!app.persist()) return;
      app.go('home');
    });
    card.appendChild(btn);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-lg';
  add.textContent = 'あたらしく はじめる';
  add.addEventListener('click', () => app.go('playerSelect', { mode: 'create' }));
  card.appendChild(add);

  root.appendChild(card);
}

function renderCreate(root, app, canCancel) {
  let name = '';
  let starterId = null;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>はじめまして！</h1>
    <p class="muted">なまえを いれて、あいぼうを えらんでね</p>
    <input id="nameInput" type="text" maxlength="20" placeholder="なまえ"
      style="width:100%;min-height:60px;font-size:22px;padding:0 14px;border:2px solid #d8e0ec;border-radius:14px;font-family:inherit">
    <h2 style="margin-top:20px">あいぼうを えらぶ</h2>
    <div class="grid-3" id="starters"></div>
    <button class="btn btn-lg" id="startBtn" style="margin-top:18px" disabled>はじめる</button>
  `;
  root.appendChild(card);

  const startersEl = card.querySelector('#starters');
  const startBtn = card.querySelector('#startBtn');
  const nameInput = card.querySelector('#nameInput');

  for (const id of STARTER_IDS) {
    const c = getCharacter(id);
    const cell = document.createElement('button');
    cell.className = 'dex-cell';
    cell.dataset.id = id;
    cell.innerHTML = `${characterSvg(id, 0, { size: 96 })}
      <div style="font-weight:bold">${c.name}</div>
      <div class="muted">${c.type}</div>`;
    cell.addEventListener('click', () => {
      starterId = id;
      [...startersEl.children].forEach((el) => {
        el.style.outline = el.dataset.id === id ? '3px solid var(--accent)' : 'none';
      });
      updateButton();
    });
    startersEl.appendChild(cell);
  }

  nameInput.addEventListener('input', () => {
    name = nameInput.value.trim();
    updateButton();
  });

  function updateButton() {
    startBtn.disabled = !(name.length >= 1 && name.length <= 20 && starterId !== null);
  }

  startBtn.addEventListener('click', () => {
    const player = createPlayer({ id: app.newId('p'), name, starterId, now: app.now() });
    app.state.players.push(player);
    app.state.activePlayerId = player.id;
    if (!app.persist()) return;
    app.go('home');
  });

  if (canCancel) {
    const back = document.createElement('button');
    back.className = 'btn btn-sub btn-lg';
    back.style.marginTop = '10px';
    back.textContent = 'もどる';
    back.addEventListener('click', () => app.go('playerSelect'));
    card.appendChild(back);
  } else {
    // プレイヤーが1人もいないときだけ（=2人目を足す画面では出さない）。
    // 「せってい」に入る前提のプレイヤーが存在しないため、ここが唯一の
    // バックアップ復元の入り口になる（安部さんの実測で発覚した設計の穴）
    appendRestoreEntry(card, app);
  }
}

/**
 * 「バックアップから もどす」。settings.js の「よみこむ」と同じ importJson を
 * 使い同じ検証を通すが、0人の場面向けに意図して非対称にしてある:
 *   - 確認ダイアログは出さない（消すものが無い）
 *   - パスワードゲートを通さない（承認設定を持つプレイヤーが存在しない）
 * 保存に失敗したときは settings.js の previousState パターンと同じ形で戻す
 */
function appendRestoreEntry(card, app) {
  const label = document.createElement('label');
  label.className = 'btn btn-sub btn-lg';
  label.style.marginTop = '10px';
  label.textContent = 'バックアップから もどす';

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
      alert(`もどせませんでした:\n${r.errors.slice(0, 3).join('\n')}`);
      file.value = '';
      return;
    }
    // 検証済みでも保存自体が失敗する（容量超過など）ことがある。その場合は
    // 元の状態（0人）へ戻し、「もどしました」のような成功は言わない
    const previousState = app.state;
    app.state = r.state;
    if (!app.persist()) {
      app.state = previousState;
      return;
    }
    app.toast('もどしました');
    app.go(app.currentPlayer() ? 'home' : 'playerSelect');
  });

  label.appendChild(file);
  card.appendChild(label);
}

/** ユーザーが入れた名前をそのまま innerHTML に入れないためのエスケープ */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
