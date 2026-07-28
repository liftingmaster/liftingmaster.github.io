/**
 * 進化の演出（キャラ絵の before→after と「◯◯は しんかした！」）だけを
 * 切り出した共通部品（仕様 §3.5）。
 *
 * けっか画面（js/views/result.js）と、きろく帳で記録を直した直後
 * （js/views/logbook.js）の両方から呼ぶ。
 *
 * けっか画面の見出しや「じこベスト こうしん！」は「いま まさに きろくした」
 * という文脈が前提の文言なので、修正の場面でそのまま流用すると
 * 「きょう きろくした」かのような誤解を生む。文脈に依存しないこの部分だけを
 * 共有する。
 */
import { characterSvg } from '../svg/character.js';
import { escapeHtml } from './playerSelect.js';

/**
 * 進化カードのHTMLを返す（DOMには足さない。呼び出し側が好きな場所に入れる）。
 *
 * @param {string} charId       進化したキャラのID
 * @param {number} stageBefore  進化前の段階（生の値。ラチェットは通さない）
 * @param {number} stageAfter   進化後の段階
 * @param {string} name         画面に出す名前（ニックネームがあればそちら）
 */
export function evolutionCardHtml(charId, stageBefore, stageAfter, name) {
  return `
    <div style="font-size:28px;font-weight:bold;color:var(--warn)">おや…？ ようすが おかしいぞ…！</div>
    <div class="row" style="justify-content:center;align-items:center;gap:8px;margin-top:10px">
      ${characterSvg(charId, stageBefore, { size: 110 })}
      <span style="font-size:32px">→</span>
      ${characterSvg(charId, stageAfter, { size: 140 })}
    </div>
    <div style="font-size:24px;font-weight:bold;margin-top:10px">${escapeHtml(name)} は しんかした！</div>
  `;
}

/** 進化カードの <div> を作って返す */
export function renderEvolutionCard(charId, stageBefore, stageAfter, name) {
  const el = document.createElement('div');
  el.style.marginTop = '18px';
  el.innerHTML = evolutionCardHtml(charId, stageBefore, stageAfter, name);
  return el;
}
