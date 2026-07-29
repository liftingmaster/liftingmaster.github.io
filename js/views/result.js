import { playerView, displayName } from '../core/player.js';
import { formatJaDate } from './recordInput.js';
import { shouldSuggestBackup } from '../core/backupPrompt.js';
import { renderEvolutionCard } from './evolutionEffect.js';
import { escapeHtml } from './playerSelect.js';

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

/** 375px 実機での、カードの内側の幅（375 − #app padding 16×2 − card padding 18×2） */
export const CARD_INNER_WIDTH = 307;

/**
 * 文字列の見た目の幅（px）のおおよそ。全角=1em・半角=0.6em・空白=0.25em で数える。
 * 実測できない環境で「この文字サイズなら1行に収まるか」を検査するための目安
 */
export function textWidth(text, fontSize) {
  return [...String(text)].reduce((w, ch) => {
    if (ch === ' ') return w + fontSize * 0.25;
    return w + fontSize * (/[\x20-\x7e]/.test(ch) ? 0.6 : 1);
  }, 0);
}

/**
 * けっか画面の文字サイズ。**2件表示（りょうほう）のときだけ一回り小さくする**。
 *
 * 375×812 の実機で「つづける」の下端が 933px＝画面の外に出ていた（2026-07-29 欠陥4）。
 * 単一モードは 549px で収まっているので、そちらは今までの寸法のまま触らない。
 *
 * いちばん効くのは いちばん大きい「モード ◯◯かい」の行。44px だと最長でも
 * 枠307pxに入りきらず必ず2行になる（1行あたり約70px×2＝約140px×2ブロック）。
 * 26px なら最長の「ワンバウンド 1000かい」でも1行に収まる（textWidth で検査）。
 * 内訳の見積り: モード表示 −95×2 / レベルアップ −52 / +EXP −5×2 /
 * じこベスト −5×2 / hr −12 ＝ 約 −275px → 933px が約 660px になる
 */
export function resultSizes(entryCount) {
  return entryCount > 1
    ? { mode: 26, exp: 22, best: 20, levelUp: 22, rule: 12 }
    : { mode: 44, exp: 26, best: 24, levelUp: 30, rule: 18 };
}

/**
 * その取引で**育成中でないキャラ**のレベルが下がったぶんを取り出す。
 *
 * その日のEXPは「いちばん よかった きろく1つぶん」だけなので、別のキャラで
 * 付けていた記録が負けると、そのキャラに渡していたEXPが取り消される
 * （例: ひのこで ノー8 → もくもに切り替えて ワン30 → ひのこ Lv4→Lv1）。
 * core は commitRecord の result.charChanges で全キャラぶん報告しているのに、
 * けっか画面もきろく入力画面もそれを読んでいなかった（2026-07-29 欠陥3）。
 * きろく帳の「なおす／けす」では同じ状況にわざわざ確認を出しているのに、
 * 記録の追加では黙ってレベルが落ちていた。
 *
 * りょうほう（2件）はひとつの取引なので、1件目で下がって2件目で戻るキャラを
 * 「下がった」と言わないよう、**最初の levelBefore と最後の levelAfter**で
 * まとめてから判定する。
 *
 * @param {Array} entries けっか画面の entries（各 result.charChanges を読む）
 * @param {Set<string>|Array<string>} trainedIds 育成中だったキャラのid（除外する）
 * @returns {Array<{charId: string, levelBefore: number, levelAfter: number, expDelta: number}>}
 */
export function benchedLevelDrops(entries, trainedIds) {
  const trained = new Set(trainedIds || []);
  const merged = new Map();
  for (const e of entries) {
    const changes = (e.result && e.result.charChanges) || [];
    for (const ch of changes) {
      if (trained.has(ch.charId)) continue;
      const prev = merged.get(ch.charId);
      if (prev) {
        prev.levelAfter = ch.levelAfter;
        prev.expDelta += ch.expDelta;
      } else {
        merged.set(ch.charId, {
          charId: ch.charId,
          levelBefore: ch.levelBefore,
          levelAfter: ch.levelAfter,
          expDelta: ch.expDelta,
        });
      }
    }
  }
  return [...merged.values()].filter((c) => c.levelAfter < c.levelBefore);
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

  // 2件表示（りょうほう）のときは全体を一回り小さくする（欠陥4。理由は resultSizes）
  const SIZE = resultSizes(entries.length);

  // 「きょう」「7がつ17にち」。+0 EXP の理由とレベル低下の説明の両方で使う
  const dateLabel = isToday ? 'きょう' : formatJaDate(date);

  entries.forEach((e, i) => {
    const r = e.result;
    const lines = [];
    // 2件目以降は区切りを入れる（1件だけのときは今までの見た目のまま）
    if (i > 0) lines.push(`<hr style="border:none;border-top:1px solid #eef1f6;margin:${SIZE.rule}px 0">`);
    lines.push(`<div style="font-size:${SIZE.mode}px;font-weight:bold">${modeLabel(e.mode)} ${e.count}かい</div>`);
    lines.push(`<div style="font-size:${SIZE.exp}px;color:var(--ok);font-weight:bold;margin-top:10px">+${r.exp} EXP</div>`);
    if (r.exp === 0) {
      // +0 EXP には理由が2通りある。どちらなのかを子どもに伝える。
      //   1. その日のEXPを別のモードが取った（EXP頭打ちルール・2026-07-28）
      //   2. 同じモードの中で、その日のベストを超えられなかった（従来どおり）
      // 1 のときに「両方やっても むだ」と読める言い方にしないこと。
      // 記録はじこベスト・れんぞく日すう・しんかの条件にちゃんと効いている
      if (r.dayWinnerMode && r.dayWinnerMode !== e.mode) {
        lines.push(
          `<p class="muted">${dateLabel}は ${modeLabel(r.dayWinnerMode)}の きろくで EXPが きまったよ<br>`
          + 'この きろくも じこベスト・れんぞく日すう・しんかの じょうけんに ちゃんと つかわれるよ</p>',
        );
      } else {
        const best = e.oldDailyBest ?? 0;
        lines.push(`<p class="muted">${dateLabel}の ベスト ${best}かいを こえると EXPが もらえるよ</p>`);
      }
    }
    if (r.isPersonalBest) {
      lines.push(`<div style="font-size:${SIZE.best}px;color:var(--warn);font-weight:bold;margin-top:10px">じこベスト こうしん！ 🎉</div>`);
    }
    if (r.levelAfter > r.levelBefore) {
      lines.push(`<div style="font-size:${SIZE.levelUp}px;color:var(--accent);font-weight:bold;margin-top:14px">レベルアップ！ Lv${r.levelBefore} → Lv${r.levelAfter}</div>`);
    } else if (r.levelAfter < r.levelBefore) {
      // 育成中のキャラ自身のレベルが下がったとき（2026-07-29 欠陥B）。
      // さかのぼって記録を足すと、その日の勝敗が引き直されて前にもらっていた EXP が
      // 取り消され、「+0 EXP なのにレベルが下がる」が起きる。ここに分岐が無かったので、
      // 画面は黙って Lv23 → Lv23 と言い続けていた（控えのキャラのぶんは
      // benchedLevelDrops が出しているが、育成中のキャラは除外されるので誰も出さない）。
      // 「レベルが さがった」を主語にすると子供が驚くので、きろく帳や欠陥3の箱と
      // 同じく「EXPが うつった」＝移動として見せ、記録は消えていないと添える
      lines.push(`<div style="font-size:${SIZE.levelUp}px;color:var(--accent);font-weight:bold;margin-top:14px">レベルが Lv${r.levelBefore} → Lv${r.levelAfter} に なったよ</div>`);
      lines.push(
        `<p class="muted">${dateLabel}の EXPは いちばん よかった きろく 1つぶんだけ。`
        + 'まえに もらっていた EXPは その きろくに うつったよ。'
        + 'きろくは きえていないから あんしんしてね</p>',
      );
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

  // 育成中でないキャラのレベルが下がったら、必ずそれを言う（欠陥3）。
  // 「レベルが下がった」を主語にすると子供が驚くので、
  // 「EXPが いまの きろくに うつった」＝移動として見せ、記録は消えていないと添える
  const drops = benchedLevelDrops(entries, entries.map((e) => e.charId));
  if (drops.length > 0) {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:16px;padding:12px 14px;border-radius:12px;background:#f4f7fb;text-align:left';
    box.innerHTML = drops.map((d) => (
      // なまえは おうちのひとが付けたニックネームなので、必ずエスケープする
      `<div style="font-size:16px;font-weight:bold">${escapeHtml(displayName(player, d.charId))}の レベルが `
      + `Lv${d.levelBefore} → Lv${d.levelAfter} に なったよ</div>`
    )).join('')
      + `<p class="muted" style="margin:6px 0 0">${dateLabel}の EXPは いちばん よかった きろく 1つぶんだけ。`
      + 'まえに もらっていた EXPは いまの きろくに うつったよ。'
      + 'きろくは きえていないから あんしんしてね</p>';
    card.appendChild(box);
  }

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
