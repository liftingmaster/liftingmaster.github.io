import { getCharacter } from '../core/characters.js';
import { stageOf, displayName, maxLevelEver } from '../core/player.js';
import { evolutionProgress } from '../core/evolution.js';
import { levelFromExp } from '../core/exp.js';
import { personalBest, recordedDates } from '../core/stats.js';
import { longestStreak } from '../core/streak.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('dexDetail', render);
}

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  if (!player || !params.charId) return app.go('dex');

  const char = getCharacter(params.charId);
  const entry = player.chars.find((c) => c.charId === char.id);
  const has = Boolean(entry);

  const card = document.createElement('div');
  card.className = 'card center';
  const no = String(char.no).padStart(3, '0');

  if (!has) {
    card.innerHTML = `
      ${characterSvg(char.id, 0, { size: 160, silhouette: true })}
      <div class="muted">No.${no}</div>
      <h1>？？？</h1>
      <p>Lv ${char.unlockLevel} で なかまに なる</p>
      <p class="muted">いまの さいこう レベル: ${maxLevelEver(player)}</p>`;
    root.appendChild(card);
    appendBack(root, app);
    return;
  }

  const stage = stageOf(player, char.id);
  const level = levelFromExp(entry.exp).level;

  card.innerHTML = `
    ${characterSvg(char.id, stage, { size: 170 })}
    <div class="muted">No.${no} ・ ${char.type}タイプ</div>
    <h1 style="margin:4px 0">${escapeHtml(displayName(player, char.id))}</h1>
    <div class="muted">${escapeHtml(char.name)} ・ Lv ${level}</div>
    <p style="text-align:left;margin-top:14px">${escapeHtml(char.dexText)}</p>
    <div class="card" style="background:#f2f6fc;box-shadow:none;text-align:left;margin-top:12px">
      <b>とくせい: ${escapeHtml(char.ability.name)}</b>
      <div class="muted">${escapeHtml(char.ability.text)}</div>
    </div>
  `;
  root.appendChild(card);

  // 進化系統図
  const line = document.createElement('div');
  line.className = 'card center';
  line.innerHTML = '<h2>しんかの ながれ</h2>';
  const row = document.createElement('div');
  row.className = 'row';
  row.style.justifyContent = 'center';
  for (const s of [0, 1, 2]) {
    const box = document.createElement('div');
    box.className = 'center';
    box.style.opacity = s <= stage ? '1' : '0.35';
    box.innerHTML = `${characterSvg(char.id, s, { size: 86, silhouette: s > stage })}
      <div class="muted">${s === 0 ? 'さいしょ' : `だい${s}しんか`}</div>`;
    row.appendChild(box);
    if (s < 2) {
      const arrow = document.createElement('div');
      arrow.textContent = '→';
      arrow.style.fontSize = '24px';
      row.appendChild(arrow);
    }
  }
  line.appendChild(row);
  root.appendChild(line);

  // 進化条件
  const ctx = {
    level,
    bestNo: personalBest(player.records, 'no'),
    bestOne: personalBest(player.records, 'one'),
    longestStreak: longestStreak(recordedDates(player.records)),
  };

  for (const targetStage of [1, 2]) {
    const prog = evolutionProgress(char.id, targetStage, ctx);
    if (!prog) continue;
    const box = document.createElement('div');
    box.className = 'card';
    const done = stage >= targetStage;
    box.innerHTML = `<h2>だい${targetStage}しんか ${done ? '（かんりょう）' : ''}</h2>
      ${targetStage === 1 ? '<p class="muted">ノーバウンド か ワンバウンド の どちらかで OK</p>' : '<p class="muted">ノーバウンド だけ</p>'}`;
    for (const item of prog.items) {
      const el = document.createElement('div');
      const ok = done || item.done;
      el.className = `check ${ok ? 'done' : 'todo'}`;
      el.innerHTML = `<span class="mark">${ok ? '✅' : '⬜'}</span>
        <span>${item.label}</span>
        ${ok ? '' : `<span class="muted">いま ${item.current} ／ あと ${item.required - item.current}</span>`}`;
      box.appendChild(el);
    }
    root.appendChild(box);
  }

  appendBack(root, app);
}

function appendBack(root, app) {
  const back = document.createElement('button');
  back.className = 'btn btn-sub btn-lg';
  back.textContent = 'もどる';
  back.addEventListener('click', () => app.go('dex'));
  root.appendChild(back);
}
