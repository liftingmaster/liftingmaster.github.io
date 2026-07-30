import { renderNav } from '../app.js';
import {
  switchChar, claimUnlock, setNickname, displayStageOf, displayName, maxLevelEver,
  maxEvolvedStageEver, canRealizeEvolution,
} from '../core/player.js';
import { pendingUnlocks } from '../core/unlock.js';
import { levelFromExp } from '../core/exp.js';
import { getCharacter } from '../core/characters.js';
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';
import { renderEvolutionCard } from './evolutionEffect.js';

export function register(app) {
  app.registerScreen('party', render);
}

function render(root, app) {
  const player = app.currentPlayer();
  if (!player) return app.go('playerSelect');

  const unlocks = pendingUnlocks(
    maxLevelEver(player),
    player.chars.map((c) => c.charId),
    maxEvolvedStageEver(player),
  );
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
    // 控えのままで進化条件を満たしているキャラには、そだてれば進化することを伝える。
    // 伝えないと「じょうけんは そろっているのに なにも おきない」だけに見える
    const hint = !isActive && canRealizeEvolution(player, entry.charId)
      ? '<div style="color:var(--warn);font-weight:bold;font-size:13px">そだてると しんかしそう！</div>'
      : '';
    cell.innerHTML = `
      ${characterSvg(entry.charId, displayStageOf(player, entry.charId), { size: 100 })}
      <div style="font-weight:bold">${escapeHtml(displayName(player, entry.charId))}</div>
      <div class="muted">Lv ${lv}${isActive ? ' ・そだてちゅう' : ''}</div>
      ${hint}`;
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
  // 進化由来の解放（level: null）はレベル到達の見出しを出せないので出し分ける
  const heading = unlock.kind === 'evolution'
    ? 'だい1しんかの ごほうび！ あたらしい なかま！'
    : `Lv${unlock.level} とうたつ！ あたらしい なかま！`;
  card.innerHTML = `<h2>${heading}</h2>
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
      const saved = app.updatePlayer((p) => claimUnlock(p, id, app.now()));
      // 保存できなかったときは「なかまに なった！」と言わない。言ってしまうと
      // 子どもは仲間が増えたと思うのに、一覧にはそのキャラがいない
      // （updatePlayer がメモリ上も元に戻している。メッセージは persist() が出す）
      if (!saved) return;
      app.toast(`${c.name} が なかまに なった！`);
      app.go('party');
    });
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  root.appendChild(card);
}

/**
 * 育成キャラに切り替えた瞬間の進化演出。
 *
 * 控えのあいだは条件を満たしても進化しない決まりなので、ここが控えのキャラが
 * 進化する唯一のタイミングになる。きろく帳の修正演出と同じく、画面遷移
 * （SCREENS への追加）はせずその場で #app を描き替え、.nav の後片付けを自分でやる
 */
function showSwitchEvolution(root, app, charId, result) {
  const player = app.currentPlayer();
  const name = displayName(player, charId);
  const card = document.createElement('div');
  card.className = 'card center';
  card.innerHTML = `<h1>${escapeHtml(name)} を そだてるよ！</h1>`;
  card.appendChild(renderEvolutionCard(charId, result.stageBefore, result.evolvedTo, name));

  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.textContent = 'つづける';
  ok.addEventListener('click', () => app.go('home'));

  root.innerHTML = '';
  root.appendChild(card);
  root.appendChild(ok);
  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav('party', app);
  window.scrollTo(0, 0);
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
      let outcome = null;
      const saved = app.updatePlayer((p) => {
        const { player: nextPlayer, result } = switchChar(p, charId);
        outcome = result;
        return nextPlayer;
      });
      // 保存できなかったときは切り替わったと言わない（updatePlayer が元に戻している）
      if (!saved) return;
      // 控えのあいだに条件を満たしていたキャラは、この瞬間に進化する。
      // ここで見せないと、evolvedStages だけ進んで絵が黙って変わる
      if (outcome && outcome.evolvedTo) {
        showSwitchEvolution(root, app, charId, outcome);
        return;
      }
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
    const saved = app.updatePlayer((p) => setNickname(p, charId, input));
    // 保存できなかったときは名前が変わったように見せない（updatePlayer が元に戻している）
    if (!saved) return;
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

  // openActions は app.render() を経由しないので、render() がやることを自分で行う。
  // 古い .nav の片付けと、先頭までのスクロール（なかまが増えると一覧は縦に伸びるため、
  // 下の方のキャラを押したときにパネルが画面外に出てしまう）
  root.innerHTML = '';
  root.appendChild(panel);
  document.querySelectorAll('.nav').forEach((el) => el.remove());
  renderNav('party', app);
  window.scrollTo(0, 0);
}
