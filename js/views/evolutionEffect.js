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
 * ふつうの寸法と、2体以上を1画面に並べるときの縮小版。
 *
 * 375×812 の実測より: 1体ぶんのブロック（カード289px＋EXPの1行）は約329px。
 * そのまま2体並べると「つづける」の下端が 872px になり、下部ナビを除いた
 * 実効高さ 739px を超えて画面の外に出る。子供がスクロールに気づかないと
 * 「つづける」に到達できないので、2体以上のときは絵と文字を縮める。
 *
 * headline は 28px だと「おや…？ ようすが おかしいぞ…！」15文字＝420px で
 * 幅311pxに入らず2行になる。20px なら 300px で1行に収まる。
 */
const SIZES = {
  full: {
    headline: 28, arrow: 32, name: 24, before: 110, after: 140, gap: 10, marginTop: 18,
  },
  compact: {
    headline: 20, arrow: 24, name: 20, before: 72, after: 92, gap: 6, marginTop: 12,
  },
};

/**
 * 進化カードのHTMLを返す（DOMには足さない。呼び出し側が好きな場所に入れる）。
 *
 * @param {string} charId       進化したキャラのID
 * @param {number} stageBefore  進化前の段階（生の値。ラチェットは通さない）
 * @param {number} stageAfter   進化後の段階
 * @param {string} name         画面に出す名前（ニックネームがあればそちら）
 * @param {object} [options]    { compact: true } で縮小版（2体以上を並べるとき）
 */
export function evolutionCardHtml(charId, stageBefore, stageAfter, name, options = {}) {
  const s = options.compact ? SIZES.compact : SIZES.full;
  return `
    <div style="font-size:${s.headline}px;font-weight:bold;color:var(--warn)">おや…？ ようすが おかしいぞ…！</div>
    <div class="row" style="justify-content:center;align-items:center;gap:8px;margin-top:${s.gap}px">
      ${characterSvg(charId, stageBefore, { size: s.before })}
      <span style="font-size:${s.arrow}px">→</span>
      ${characterSvg(charId, stageAfter, { size: s.after })}
    </div>
    <div style="font-size:${s.name}px;font-weight:bold;margin-top:${s.gap}px">${escapeHtml(name)} は しんかした！</div>
  `;
}

/** 進化カードの <div> を作って返す */
export function renderEvolutionCard(charId, stageBefore, stageAfter, name, options = {}) {
  const s = options.compact ? SIZES.compact : SIZES.full;
  const el = document.createElement('div');
  el.style.marginTop = `${s.marginTop}px`;
  el.innerHTML = evolutionCardHtml(charId, stageBefore, stageAfter, name, options);
  return el;
}
