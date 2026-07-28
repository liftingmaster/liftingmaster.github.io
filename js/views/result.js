import { playerView, displayName } from '../core/player.js';
import { formatJaDate } from './recordInput.js';
import { shouldSuggestBackup } from '../core/backupPrompt.js';
import { renderEvolutionCard } from './evolutionEffect.js';

export function register(app) {
  app.registerScreen('result', render);
}

/**
 * params.entries = [{ result, count, mode, oldDailyBest, charId, stageBefore }, ...]
 * （ノー→ワンの順で最大2件。仕様 §4.5）
 *
 * 単一モードの記録も entries に1件だけ入れて同じ経路を通す。見た目は今までと変わらない。
 * 古い呼び出し（params.result 1件）もそのまま受けられるようにしておく
 */
function toEntries(params) {
  if (Array.isArray(params.entries) && params.entries.length > 0) return params.entries;
  if (params.result) {
    return [{
      result: params.result,
      count: params.count,
      mode: params.mode,
      oldDailyBest: params.oldDailyBest,
      charId: params.charId,
      stageBefore: params.stageBefore,
    }];
  }
  return [];
}

function modeLabel(mode) {
  return mode === 'no' ? 'ノーバウンド' : 'ワンバウンド';
}

function render(root, app, params = {}) {
  const player = app.currentPlayer();
  const entries = toEntries(params);
  if (!player || entries.length === 0) return app.go('home');

  // 過去日の記録では見出しでも「きょう」と言わない。どの日の記録か分かるようにする
  const date = params.date || app.today();
  const isToday = date === app.today();
  const heading = isToday ? 'きろくしたよ！' : `${formatJaDate(date)}の きろく、つけたよ！`;

  const card = document.createElement('div');
  card.className = 'card center';
  card.innerHTML = `<h1>${heading}</h1>`;

  // 承認ONのときは全件が承認待ち。EXPの話はせず、回数だけ並べて1つの案内で締める
  if (entries.every((e) => e.result.queued)) {
    const v = playerView(player, app.today());
    for (const e of entries) {
      card.insertAdjacentHTML(
        'beforeend',
        `<div style="font-size:44px;font-weight:bold">${modeLabel(e.mode)} ${e.count}かい</div>`,
      );
    }
    card.insertAdjacentHTML(
      'beforeend',
      '<p style="margin-top:16px">おうちのひとが みとめると レベルが あがるよ</p>'
      + `<p class="muted">しょうにん まち ${v.pendingCount}けん</p>`,
    );
    root.appendChild(card);
    appendContinue(root, app);
    return;
  }

  // りょうほう記録で2件とも進化した場合は、きろく帳と同じく縮小版にする
  // （ふつうの寸法で2枚並べると「つづける」が画面の外に出る）
  const compactEvolution = entries.filter((e) => e.result.evolvedTo).length > 1;

  entries.forEach((e, i) => {
    const r = e.result;
    const lines = [];
    // 2件目以降は区切りを入れる（1件だけのときは今までの見た目のまま）
    if (i > 0) lines.push('<hr style="border:none;border-top:1px solid #eef1f6;margin:18px 0">');
    lines.push(`<div style="font-size:44px;font-weight:bold">${modeLabel(e.mode)} ${e.count}かい</div>`);
    lines.push(`<div style="font-size:26px;color:var(--ok);font-weight:bold;margin-top:10px">+${r.exp} EXP</div>`);
    if (r.exp === 0) {
      // 2回目以降の記録が +0 EXP になる理由と、何回を超えればよいかを示す
      const dateLabel = isToday ? 'きょう' : formatJaDate(date);
      const best = e.oldDailyBest ?? 0;
      lines.push(`<p class="muted">${dateLabel}の ベスト ${best}かいを こえると EXPが もらえるよ</p>`);
    }
    if (r.isPersonalBest) {
      lines.push('<div style="font-size:24px;color:var(--warn);font-weight:bold;margin-top:10px">じこベスト こうしん！ 🎉</div>');
    }
    if (r.levelAfter > r.levelBefore) {
      lines.push(`<div style="font-size:30px;color:var(--accent);font-weight:bold;margin-top:14px">レベルアップ！ Lv${r.levelBefore} → Lv${r.levelAfter}</div>`);
    }
    card.insertAdjacentHTML('beforeend', lines.join(''));

    if (r.evolvedTo) {
      // 進化演出は js/views/evolutionEffect.js の共通部品。きろく帳の修正でも同じものを使う
      card.appendChild(renderEvolutionCard(
        e.charId, e.stageBefore, r.evolvedTo, displayName(player, e.charId),
        { compact: compactEvolution },
      ));
    }
  });

  // 新しい仲間は最後のエントリのぶんだけ。pendingUnlocks は毎回「今の累積から見た
  // 未受取一覧」を返すので、1件目と2件目を足すと同じ仲間が二重に出る（仕様 §4.5）
  const last = entries[entries.length - 1].result;
  if (last.unlocks.length > 0) {
    const un = document.createElement('div');
    un.style.marginTop = '18px';
    un.innerHTML = '<div style="font-size:22px;font-weight:bold;color:var(--accent)">あたらしい なかまが あらわれた！</div>';
    card.appendChild(un);
  }

  // 演出のいちばん最後に、控えめに添える。祝いの邪魔をしないよう、
  // 進化・新しい仲間・レベル10またぎの節目があり、かつしばらく
  // バックアップしていないときだけ出す（判定は js/core/backupPrompt.js）
  const first = entries[0].result;
  const milestone = {
    evolved: entries.some((e) => !!e.result.evolvedTo),
    unlocked: last.unlocks.length > 0,
    levelBefore: first.levelBefore,
    levelAfter: last.levelAfter,
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

  root.appendChild(card);
  appendContinue(root, app);
}

function appendContinue(root, app) {
  const ok = document.createElement('button');
  ok.className = 'btn btn-lg';
  ok.textContent = 'つづける';
  ok.addEventListener('click', () => app.go('home'));
  root.appendChild(ok);
}
