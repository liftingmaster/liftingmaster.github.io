import { renderNav } from '../app.js';
import { playerView, progressOf, maxLevelEver } from '../core/player.js';
import { pendingUnlocks } from '../core/unlock.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';

export function register(app) {
  app.registerScreen('home', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const v = playerView(player, app.today());

  // 1. 承認の通知を出して消す
  if (player.pendingEffects && player.pendingEffects.length > 0) {
    const total = player.pendingEffects.reduce((s, e) => s + (e.exp || 0), 0);
    const count = player.pendingEffects.reduce((s, e) => s + (e.count || 0), 0);
    const note = document.createElement('div');
    note.className = 'card';
    note.style.background = '#e9f7ef';
    note.innerHTML = `<h2>おうちのひとが みとめてくれた！</h2>
      <p>${count}けんの きろくが ついかされて <b>${total} EXP</b> もらったよ</p>`;
    root.appendChild(note);
    const cleared = app.updatePlayer((p) => ({ ...p, pendingEffects: [] }));
    // ここは失敗しても安全側（お知らせが残るだけで、EXP は承認時にすでに入っている）に
    // 倒れるが、「updatePlayer の戻り値を必ず見る」という約束は4か所すべてで守る。
    // 消せていないなら次に開いたときも同じお知らせが出るので、それを先に伝えておく
    if (!cleared) {
      note.insertAdjacentHTML(
        'beforeend',
        '<p class="muted">（ほぞんできなかったので、つぎに ひらいたときも でるよ）</p>'
      );
    }
  }

  // 2. 受け取り待ちの仲間
  const unlocks = pendingUnlocks(maxLevelEver(player), player.chars.map((c) => c.charId));
  if (unlocks.length > 0) {
    const note = document.createElement('div');
    note.className = 'card';
    note.style.background = '#fff6e5';
    note.innerHTML = '<h2>あたらしい なかまが まってるよ！</h2>';
    const go = document.createElement('button');
    go.className = 'btn btn-lg';
    go.textContent = 'なかまを むかえにいく';
    go.addEventListener('click', () => app.go('party'));
    note.appendChild(go);
    root.appendChild(note);
  }

  // 3-6. キャラ本体
  const card = document.createElement('div');
  card.className = 'card center';
  const pct = v.expToNextLevel > 0 ? Math.round((v.expIntoLevel / v.expToNextLevel) * 100) : 100;
  const prog = progressOf(player, v.charId);
  const almost = prog && !prog.met && prog.items[0].done; // レベル条件だけ満たしている

  card.innerHTML = `
    <div style="position:relative;display:inline-block">
      ${characterSvg(v.charId, v.stage, { size: 200 })}
      ${almost ? '<div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 34px 10px #ffe08a;pointer-events:none"></div>' : ''}
    </div>
    <h1 style="margin:6px 0 0">${escapeHtml(v.charName)}</h1>
    <div style="font-size:22px;font-weight:bold;color:var(--accent)">Lv ${v.level}</div>
    <div class="expbar" style="margin:10px 0 4px"><span style="width:${pct}%"></span></div>
    <div class="muted">${v.expToNextLevel > 0 ? `つぎの レベルまで あと ${v.expToNextLevel - v.expIntoLevel} EXP` : 'さいこう レベル！'}</div>
    ${almost ? '<div style="margin-top:10px;color:var(--warn);font-weight:bold">なにかが おこりそう…！</div>' : ''}
  `;
  root.appendChild(card);

  if (prog && !prog.met) {
    const evo = document.createElement('div');
    evo.className = 'card';
    evo.innerHTML = '<h2>しんかの じょうけん</h2>';
    for (const item of prog.items) {
      const line = document.createElement('div');
      line.className = `check ${item.done ? 'done' : 'todo'}`;
      const rest = item.required - item.current;
      line.innerHTML = `<span class="mark">${item.done ? '✅' : '⬜'}</span>
        <span>${item.label}</span>
        ${item.done ? '' : `<span class="muted">あと ${rest}</span>`}`;
      evo.appendChild(line);
    }
    root.appendChild(evo);
  }

  const stats = document.createElement('div');
  stats.className = 'card';
  stats.innerHTML = `
    <div class="row-between"><span>れんぞく きろく</span><b>${v.currentStreak} にち</b></div>
    <div class="row-between"><span>さいちょう れんぞく</span><b>${v.longestStreak} にち</b></div>
    <hr style="border:none;border-top:1px solid #eef1f6;margin:12px 0">
    <div class="row-between"><span>ノーバウンド さいこう</span><b>${v.bestNo} かい</b></div>
    <div class="row-between"><span>ワンバウンド さいこう</span><b>${v.bestOne} かい</b></div>
  `;
  root.appendChild(stats);

  const recBtn = document.createElement('button');
  recBtn.className = 'btn btn-lg';
  recBtn.textContent = 'きろくする';
  recBtn.addEventListener('click', () => app.go('recordInput'));
  root.appendChild(recBtn);

  if (v.pendingCount > 0) {
    const pend = document.createElement('div');
    pend.className = 'card';
    pend.style.marginTop = '16px';
    pend.innerHTML = `<div class="row-between">
      <span>しょうにん まち <b>${v.pendingCount}けん</b></span>
      <button class="btn btn-sub" id="toApproval">おうちのひと</button>
    </div>`;
    pend.querySelector('#toApproval').addEventListener('click', () => app.go('approval'));
    root.appendChild(pend);
  }

  renderNav('home', app);
}
