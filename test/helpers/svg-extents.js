/**
 * characterSvg() が返す SVG 文字列から、実際に描かれる図形の外接範囲を出す。
 * テスト（test/character-svg.test.js）と、手元で当たりを見るときに使う。
 *
 * `node --test test/*.test.js` は test 直下の *.test.js しか拾わないので、
 * このファイルはテストとしては実行されない。
 *
 * 対応するのは js/svg/character.js が実際に出している範囲だけ:
 *   <circle> <ellipse> <rect> <path>、path のコマンドは M/m L/l q/Q z/Z。
 * stroke があるときは線幅の半分だけ外へふくらませる（見た目の端はそこまで届くため）。
 */

const NUM = '-?\\d*\\.?\\d+';

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** stroke があるときのはみ出し幅（線の中心から外側へ半分） */
function strokePad(a) {
  if (!a.stroke || a.stroke === 'none') return 0;
  return num(a['stroke-width'], 1) / 2;
}

/** 2次ベジェの、ある軸方向の最小・最大（極値を厳密に解く） */
function quadRange(p0, p1, p2) {
  const values = [p0, p2];
  const denom = p0 - 2 * p1 + p2;
  if (denom !== 0) {
    const t = (p0 - p1) / denom;
    if (t > 0 && t < 1) {
      values.push((1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2);
    }
  }
  return [Math.min(...values), Math.max(...values)];
}

/** d 属性をなぞって、通る点の最小・最大を返す */
function pathBox(d) {
  const tokens = d.match(new RegExp(`[MmLlQqZz]|${NUM}`, 'g')) || [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const hit = (px, py) => {
    box.minX = Math.min(box.minX, px); box.maxX = Math.max(box.maxX, px);
    box.minY = Math.min(box.minY, py); box.maxY = Math.max(box.maxY, py);
  };
  const next = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[MmLlQqZz]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z' || cmd === 'z') { x = startX; y = startY; cmd = null; continue; }
    if (cmd === undefined || cmd === null) break;

    if (cmd === 'M' || cmd === 'm') {
      const dx = next(); const dy = next();
      x = cmd === 'M' ? dx : x + dx;
      y = cmd === 'M' ? dy : y + dy;
      startX = x; startY = y;
      hit(x, y);
      // SVG の仕様どおり、M のあとに続く数値は L 扱いにする
      cmd = cmd === 'M' ? 'L' : 'l';
    } else if (cmd === 'L' || cmd === 'l') {
      const dx = next(); const dy = next();
      x = cmd === 'L' ? dx : x + dx;
      y = cmd === 'L' ? dy : y + dy;
      hit(x, y);
    } else if (cmd === 'Q' || cmd === 'q') {
      const a1 = next(); const b1 = next(); const a2 = next(); const b2 = next();
      const cx = cmd === 'Q' ? a1 : x + a1;
      const cy = cmd === 'Q' ? b1 : y + b1;
      const ex = cmd === 'Q' ? a2 : x + a2;
      const ey = cmd === 'Q' ? b2 : y + b2;
      const [lo, hi] = quadRange(x, cx, ex);
      const [lo2, hi2] = quadRange(y, cy, ey);
      hit(lo, lo2); hit(hi, hi2);
      x = ex; y = ey;
    } else {
      throw new Error(`未対応のパスコマンド: ${cmd}`);
    }
  }
  return box;
}

/** SVG 文字列の中の図形ごとに { kind, minX, minY, maxX, maxY } を返す */
export function svgExtents(svg) {
  const out = [];
  for (const m of svg.matchAll(/<(circle|ellipse|rect|path)\b([^>]*)>/g)) {
    const kind = m[1];
    const a = attrs(m[0]);
    const pad = strokePad(a);
    if (a.fill === 'none' && pad === 0) continue; // 何も描かれない

    if (kind === 'circle') {
      const r = num(a.r) + pad;
      out.push({ kind, minX: num(a.cx) - r, maxX: num(a.cx) + r, minY: num(a.cy) - r, maxY: num(a.cy) + r });
    } else if (kind === 'ellipse') {
      const rx = num(a.rx) + pad;
      const ry = num(a.ry) + pad;
      out.push({ kind, minX: num(a.cx) - rx, maxX: num(a.cx) + rx, minY: num(a.cy) - ry, maxY: num(a.cy) + ry });
    } else if (kind === 'rect') {
      out.push({
        kind,
        minX: num(a.x) - pad,
        maxX: num(a.x) + num(a.width) + pad,
        minY: num(a.y) - pad,
        maxY: num(a.y) + num(a.height) + pad,
      });
    } else {
      const b = pathBox(a.d);
      out.push({ kind, minX: b.minX - pad, maxX: b.maxX + pad, minY: b.minY - pad, maxY: b.maxY + pad });
    }
  }
  return out;
}
