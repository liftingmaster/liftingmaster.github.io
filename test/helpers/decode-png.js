/**
 * 生成した PNG の中身を検査するための道具立て。
 *
 * decodePng は tools/prepare-art.js のものを再輸出しているだけ。
 *
 * 以前はここに同じデコーダを複製し、「あちらは CLI なので import すると
 * process.exit(2) でテストランナーが落ちる」を理由にしていた。
 * tools/prepare-art.js をライブラリ部とCLI部に分けた時点で、その理由は
 * 事実でなくなった（import しても main() は走らない）。実際、複製との差は
 * import 行と hasAlpha フィールドだけで、デコード本体は1文字も違わなかった。
 *
 * **独立した実装のふりをした複製**は、「片方だけ直して食い違う」危険を増やす
 * だけで、検知力を1つも増やさない（挙動が食い違う入力が存在しないので、
 * 「2つの実装が相殺し合ってバグを見逃す」ことも起きようがなかった）。
 * 本当に独立させたい（デコーダ自体のバグを相殺なしで検出したい）なら、
 * 別のアルゴリズムで書き直すこと。同じコードを2か所に置くのは不可。
 *
 * decodePng の返り値: { width, height, data(RGBA), hasAlpha }
 */
export { decodePng } from '../../tools/prepare-art.js';

/** 完全に透明（alpha=0）な画素の割合をパーセントで返す */
export function transparentRatio(img) {
  const n = img.width * img.height;
  let clear = 0;
  for (let i = 0; i < n; i += 1) if (img.data[i * 4 + 3] === 0) clear += 1;
  return (clear / n) * 100;
}

/** 四隅の alpha。キーは失敗メッセージに出す名前 */
export function cornerAlphas(img) {
  const { width, height, data } = img;
  const at = (x, y) => data[(y * width + x) * 4 + 3];
  return {
    左上: at(0, 0),
    右上: at(width - 1, 0),
    左下: at(0, height - 1),
    右下: at(width - 1, height - 1),
  };
}

/**
 * alpha が lo〜hi（両端を含む）の画素だけの平均色。1つも無ければ null。
 * 「不透明部分だけの平均色」「半透明の輪郭だけの平均色」を出し分けるのに使う。
 */
export function averageColorInAlphaBand(img, lo, hi) {
  const n = img.width * img.height;
  let count = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const a = img.data[i * 4 + 3];
    if (a < lo || a > hi) continue;
    r += img.data[i * 4];
    g += img.data[i * 4 + 1];
    b += img.data[i * 4 + 2];
    count += 1;
  }
  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count, count };
}

/** 彩度（最大チャンネル − 最小チャンネル） */
export function saturation({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}
