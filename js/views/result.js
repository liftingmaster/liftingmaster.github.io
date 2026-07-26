import { playerView, displayName } from '../core/player.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('result', render);
}

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  if (!player || !params.result) return app.go('home');

  const r = params.result;
  const modeLabel = params.mode === 'no' ? 'ノーバウンド' : 'ワンバウンド';

  const card = document.createElement('div');
  card.className = 'card center';

  if (r.queued) {
    const v = playerView(player, app.today());
    card.innerHTML = `
      <h1>きろくしたよ！</h1>
      <div style="font-size:44px;font-weight:bold">${modeLabel} ${params.count}かい</div>
      <p style="margin-top:16px">おうちのひとが みとめると レベルが あがるよ</p>
      <p class="muted">しょうにん まち ${v.pendingCount}けん</p>
    `;
  } else {
    const lines = [];
    lines.push('<h1>きろくしたよ！</h1>');
    lines.push(`<div style="font-size:44px;font-weight:bold">${modeLabel} ${params.count}かい</div>`);
    lines.push(`<div style="font-size:26px;color:var(--ok);font-weight:bold;margin-top:10px">+${r.exp} EXP</div>`);
    if (r.exp === 0) {
      lines.push('<p class="muted">きょうの さいこう きろくを こえると EXPが もらえるよ</p>');
    }
    if (r.isPersonalBest) {
      lines.push('<div style="font-size:24px;color:var(--warn);font-weight:bold;margin-top:10px">じこベスト こうしん！ 🎉</div>');
    }
    if (r.levelAfter > r.levelBefore) {
      lines.push(`<div style="font-size:30px;color:var(--accent);font-weight:bold;margin-top:14px">レベルアップ！ Lv${r.levelBefore} → Lv${r.levelAfter}</div>`);
    }
    card.innerHTML = lines.join('');

    if (r.evolvedTo) {
      const evo = document.createElement('div');
      evo.style.marginTop = '18px';
      evo.innerHTML = `
        <div style="font-size:28px;font-weight:bold;color:var(--warn)">おや…？ ようすが おかしいぞ…！</div>
        <div class="row" style="justify-content:center;align-items:center;gap:8px;margin-top:10px">
          ${characterSvg(params.charId, params.stageBefore, { size: 110 })}
          <span style="font-size:32px">→</span>
          ${characterSvg(params.charId, r.evolvedTo, { size: 140 })}
        </div>
        <div style="font-size:24px;font-weight:bold;margin-top:10px">${escapeHtml(displayName(player, params.charId))} は しんかした！</div>
      `;
      card.appendChild(evo);
    }

    if (r.unlocks.length > 0) {
      const un = document.createElement('div');
      un.style.marginTop = '18px';
      un.innerHTML = '<div style="font-size:22px;font-weight:bold;color:var(--accent)">あたらしい なかまが あらわれた！</div>';
      card.appendChild(un);
    }
  }

  root.appendChild(card);

  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.textContent = 'つづける';
  ok.addEventListener('click', () => app.go('home'));
  root.appendChild(ok);
}
