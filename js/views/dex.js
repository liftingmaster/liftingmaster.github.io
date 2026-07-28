import { renderNav } from '../app.js';
import { CHARACTERS } from '../core/characters.js';
import { displayStageOf } from '../core/player.js';
import { characterSvg } from '../svg/character.js';

export function register(app) {
  app.registerScreen('dex', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const owned = new Set(player.chars.map((c) => c.charId));

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h1>ずかん</h1>
    <p class="muted">${owned.size} / ${CHARACTERS.length} たい ゲット</p>`;

  const grid = document.createElement('div');
  grid.className = 'dex-grid';

  for (const c of CHARACTERS) {
    const has = owned.has(c.id);
    const cell = document.createElement('button');
    cell.className = 'dex-cell';
    const no = String(c.no).padStart(3, '0');
    cell.innerHTML = has
      ? `${characterSvg(c.id, displayStageOf(player, c.id), { size: 90 })}
         <div class="muted">No.${no}</div>
         <div style="font-weight:bold">${c.name}</div>`
      : `${characterSvg(c.id, 0, { size: 90, silhouette: true })}
         <div class="muted">No.${no}</div>
         <div style="font-weight:bold">？？？</div>`;
    cell.addEventListener('click', () => app.go('dexDetail', { charId: c.id }));
    grid.appendChild(cell);
  }

  card.appendChild(grid);
  root.appendChild(card);
  renderNav('dex', app);
}
