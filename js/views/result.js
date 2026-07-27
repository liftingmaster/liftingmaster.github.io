import { playerView, displayName } from '../core/player.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';
import { formatJaDate } from './recordInput.js';
import { shouldSuggestBackup } from '../core/backupPrompt.js';

export function register(app) {
  app.registerScreen('result', render);
}

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  if (!player || !params.result) return app.go('home');

  const r = params.result;
  const modeLabel = params.mode === 'no' ? 'ノーバウンド' : 'ワンバウンド';
  // 過去日の記録では見出しでも「きょう」と言わない。どの日の記録か分かるようにする
  const date = params.date || app.today();
  const isToday = date === app.today();
  const heading = isToday ? 'きろくしたよ！' : `${formatJaDate(date)}の きろく、つけたよ！`;

  const card = document.createElement('div');
  card.className = 'card center';

  if (r.queued) {
    const v = playerView(player, app.today());
    card.innerHTML = `
      <h1>${heading}</h1>
      <div style="font-size:44px;font-weight:bold">${modeLabel} ${params.count}かい</div>
      <p style="margin-top:16px">おうちのひとが みとめると レベルが あがるよ</p>
      <p class="muted">しょうにん まち ${v.pendingCount}けん</p>
    `;
  } else {
    const lines = [];
    lines.push(`<h1>${heading}</h1>`);
    lines.push(`<div style="font-size:44px;font-weight:bold">${modeLabel} ${params.count}かい</div>`);
    lines.push(`<div style="font-size:26px;color:var(--ok);font-weight:bold;margin-top:10px">+${r.exp} EXP</div>`);
    if (r.exp === 0) {
      // 2回目以降の記録が +0 EXP になる理由と、何回を超えればよいかを示す
      const dateLabel = isToday ? 'きょう' : formatJaDate(date);
      const best = params.oldDailyBest ?? 0;
      lines.push(`<p class="muted">${dateLabel}の ベスト ${best}かいを こえると EXPが もらえるよ</p>`);
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

    // 演出のいちばん最後に、控えめに添える。祝いの邪魔をしないよう、
    // 進化・新しい仲間・レベル10またぎの節目があり、かつしばらく
    // バックアップしていないときだけ出す（判定は js/core/backupPrompt.js）
    const milestone = {
      evolved: !!r.evolvedTo,
      unlocked: r.unlocks.length > 0,
      levelBefore: r.levelBefore,
      levelAfter: r.levelAfter,
    };
    if (shouldSuggestBackup(milestone, app.state.lastBackupAt, app.now())) {
      const backupNotice = document.createElement('div');
      backupNotice.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid #e5e5e5';
      backupNotice.innerHTML = '<p class="muted" style="font-size:15px">'
        + 'おうちのひとへ: きろくを ほぞんしておくと あんしんです</p>';
      const toSettings = document.createElement('button');
      toSettings.className = 'btn btn-sub';
      toSettings.style.marginTop = '6px';
      toSettings.textContent = 'せっていへ';
      toSettings.addEventListener('click', () => app.go('settings'));
      backupNotice.appendChild(toSettings);
      card.appendChild(backupNotice);
    }
  }

  root.appendChild(card);

  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.textContent = 'つづける';
  ok.addEventListener('click', () => app.go('home'));
  root.appendChild(ok);
}
