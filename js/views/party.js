import { renderNav } from '../app.js';
import {
  switchChar, claimUnlock, setNickname, stageOf, displayName, maxLevelEver,
} from '../core/player.js';
import { pendingUnlocks } from '../core/unlock.js';
import { levelFromExp } from '../core/exp.js';
import { getCharacter } from '../core/characters.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('party', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const unlocks = pendingUnlocks(maxLevelEver(player), player.chars.map((c) => c.charId));
  if (unlocks.length > 0) renderUnlock(root, app, unlocks[0]);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h1>なかま</h1><p class="muted">そだてる キャラを えらべるよ。ほかの キャラの レベルは そのまま のこるよ。</p>';

  const grid = document.createElement('div');
  grid.className = 'dex-grid';
  for (const entry of player.chars) {
    const lv = levelFromExp(entry.exp).level;
    const isActive = entry.charId === player.activeCharId;
    const cell = document.createElement('button');
    cell.className = 'dex-cell';
    if (isActive) cell.style.outline = '3px solid var(--accent)';
    cell.innerHTML = `
      ${characterSvg(entry.charId, stageOf(player, entry.charId), { size: 100 })}
      <div style="font-weight:bold">${escapeHtml(displayName(player, entry.charId))}</div>
      <div class="muted">Lv ${lv}${isActive ? ' ・そだてちゅう' : ''}</div>`;
    cell.addEventListener('click', () => openActions(root, app, entry.charId, isActive));
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  root.appendChild(card);

  renderNav('party', app);
}

function renderUnlock(root, app, unlock) {
  const card = document.createElement('div');
  card.className = 'card center';
  card.style.background = '#fff6e5';
  card.innerHTML = `<h2>Lv${unlock.level} とうたつ！ あたらしい なかま！</h2>
    <p class="muted">${unlock.choices.length > 1 ? 'どちらかを えらんでね' : 'なかまに なりたそうに こっちを みている'}</p>`;

  const grid = document.createElement('div');
  grid.className = unlock.choices.length > 1 ? 'grid-3' : '';
  for (const id of unlock.choices) {
    const c = getCharacter(id);
    const cell = document.createElement('button');
    cell.className = 'dex-cell';
    cell.innerHTML = `${characterSvg(id, 0, { size: 110 })}
      <div style="font-weight:bold">${escapeHtml(c.name)}</div>
      <div class="muted">${escapeHtml(c.type)}</div>`;
    cell.addEventListener('click', () => {
      app.updatePlayer((p) => claimUnlock(p, id, app.now()));
      app.toast(`${c.name} が なかまに なった！`);
      app.go('party');
    });
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  root.appendChild(card);
}

function openActions(root, app, charId, isActive) {
  const player = app.currentPlayer();
  const name = displayName(player, charId);

  const panel = document.createElement('div');
  panel.className = 'card';
  panel.innerHTML = `<h2>${escapeHtml(name)}</h2>`;

  if (!isActive) {
    const grow = document.createElement('button');
    grow.className = 'btn btn-lg';
    grow.textContent = 'この こを そだてる';
    grow.addEventListener('click', () => {
      const ok = confirm(`${name} を そだてます。いまの キャラの レベルは のこります。いいですか？`);
      if (!ok) return;
      app.updatePlayer((p) => switchChar(p, charId));
      app.toast(`${name} を そだてるよ！`);
      app.go('home');
    });
    panel.appendChild(grow);
  }

  const rename = document.createElement('button');
  rename.className = 'btn btn-sub btn-lg';
  rename.style.marginTop = '10px';
  rename.textContent = 'なまえを つける';
  rename.addEventListener('click', () => {
    const input = prompt('あたらしい なまえ（10もじまで／からっぽで もとの なまえ）', name);
    if (input === null) return;
    app.updatePlayer((p) => setNickname(p, charId, input));
    app.go('party');
  });
  panel.appendChild(rename);

  const detail = document.createElement('button');
  detail.className = 'btn btn-sub btn-lg';
  detail.style.marginTop = '10px';
  detail.textContent = 'ずかんを みる';
  detail.addEventListener('click', () => app.go('dexDetail', { charId }));
  panel.appendChild(detail);

  const close = document.createElement('button');
  close.className = 'btn btn-sub btn-lg';
  close.style.marginTop = '10px';
  close.textContent = 'とじる';
  close.addEventListener('click', () => app.go('party'));
  panel.appendChild(close);

  root.innerHTML = '';
  root.appendChild(panel);
  // openActions は app.render() を経由しないので、自分で古い .nav を片付けてから足す
  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav('party', app);
}
