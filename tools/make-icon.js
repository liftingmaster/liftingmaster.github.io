/**
 * 依存ゼロで PNG アイコンを作る。
 * Node 標準の zlib だけで PNG を組み立てる（画像ライブラリを入れないため）。
 * 実行: node tools/make-icon.js
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // ビット深度
  ihdr[9] = 6;   // カラータイプ RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;  // フィルタなし
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function blend(buf, w, x, y, [r, g, b], alpha) {
  if (alpha <= 0) return;
  const i = (y * w + x) * 4;
  const a = Math.min(1, alpha);
  buf[i] = Math.round(buf[i] * (1 - a) + r * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + g * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + b * a);
  buf[i + 3] = 255;
}

/**
 * サッカーボールの革のパターン（単位円のなかで定義）。
 *
 * 平面にそのまま五角形を描くと「板」に見える。正射影の球では、画面半径 rho の点は
 * 球面上の角度 asin(rho) に対応するので、画面座標をこの角度へ写してからパターンを
 * 引くと、革が球面に貼り付いて見える（外周ほど引き伸ばされる）。
 *
 * 逆に「画面半径 s に見せたい要素」は、パターン半径 asin(s)/(π/2) に置く必要がある。
 * この逆算を忘れると中央の五角形だけが肥大するので注意（実際に一度やった）。
 */
const toPattern = (s) => Math.asin(Math.min(1, s)) / (Math.PI / 2);
const R_CENTER = toPattern(0.30);   // 中央の五角形を画面半径 0.30 に見せる
const D_OUTER = toPattern(0.74);    // まわりの五角形の中心を画面半径 0.74 に
const R_OUTER = toPattern(0.30);

function pentagon(cx, cy, r, rotDeg) {
  const pts = [];
  for (let i = 0; i < 5; i += 1) {
    const a = ((rotDeg + 72 * i) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// 中央に1つ、その各辺の外側に1つずつで計6つ
const PATCHES = (() => {
  const list = [pentagon(0, 0, R_CENTER, -90)];
  for (let k = 0; k < 5; k += 1) {
    const phi = -54 + 72 * k;
    const rad = (phi * Math.PI) / 180;
    list.push(pentagon(Math.cos(rad) * D_OUTER, Math.sin(rad) * D_OUTER, R_OUTER, phi));
  }
  return list;
})();

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 画面座標（単位円）が黒い革の上か */
function isBlack(u, v) {
  const rho = Math.hypot(u, v);
  if (rho >= 1) return false;
  const stretched = Math.asin(Math.min(1, rho)) / (Math.PI / 2);
  const k = rho === 0 ? 0 : stretched / rho;
  return PATCHES.some((p) => inPoly(u * k, v * k, p));
}

/** たてグラデ＋角丸（radiusRatio=0 で切り欠きなしの四角＝maskable 用） */
function background(buf, size, topHex, botHex, radiusRatio, vignette) {
  const t = hex(topHex); const b = hex(botHex);
  const radius = size * radiusRatio;
  for (let y = 0; y < size; y += 1) {
    const k = y / (size - 1);
    const col = [0, 1, 2].map((i) => t[i] * (1 - k) + b[i] * k);
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x, x - (size - radius), 0);
      const dy = Math.max(radius - y, y - (size - radius), 0);
      const d = Math.hypot(dx, dy);
      // radius=0（maskable の四隅まで塗る場合）はアンチエイリアスの式が 0.5 を返して
      // アイコン全体が半透明になる。切り欠きが無いときは素直に不透明で塗る
      const a = radius <= 0 ? 1 : Math.min(1, (radius - d) / 1.5 + 0.5);
      if (a <= 0) continue;
      const rr = Math.hypot(x / size - 0.5, y / size - 0.5) / 0.707;
      const f = 1 - vignette * rr * rr;
      blendRgb(buf, size, x, y, col.map((v) => v * f), a);
    }
  }
}

function blendRgb(buf, w, x, y, [r, g, b], a) {
  const i = (y * w + x) * 4;
  buf[i] = Math.round(buf[i] * (1 - a) + r * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + g * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + b * a);
  buf[i + 3] = Math.round(buf[i + 3] * (1 - a) + 255 * a);
}

/** ボール本体。3x3 のスーパーサンプリングでふちと革の境目を滑らかにする */
function ball(buf, size, cx, cy, R) {
  const ln = Math.hypot(-0.45, -0.55, 0.70);
  const lx = -0.45 / ln; const ly = -0.55 / ln; const lz = 0.70 / ln;
  const S = 3;
  for (let y = Math.max(0, Math.floor(cy - R - 3)); y <= Math.min(size - 1, Math.ceil(cy + R + 3)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - R - 3)); x <= Math.min(size - 1, Math.ceil(cx + R + 3)); x += 1) {
      let sum = 0; let hit = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const u = (x + (sx + 0.5) / S - cx) / R;
          const v = (y + (sy + 0.5) / S - cy) / R;
          const rho = Math.hypot(u, v);
          if (rho >= 1) continue;
          const nz = Math.sqrt(Math.max(0, 1 - rho * rho));
          const diff = Math.max(0, u * lx + v * ly + nz * lz);
          const black = isBlack(u, v);
          let c = (black ? 34 : 252) * (0.34 + 0.66 * diff) * (0.55 + 0.45 * nz ** 0.6);
          c += 210 * diff ** 28 * (black ? 0.55 : 0.85);   // つや
          sum += Math.max(0, Math.min(255, c));
          hit += 1;
        }
      }
      if (!hit) continue;
      blendRgb(buf, size, x, y, [sum / hit, sum / hit, sum / hit], hit / (S * S));
    }
  }
}

/** 足元の接地影 */
function shadow(buf, size, cx, cy, rx, ry, strength) {
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y += 1) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const a = strength * (1 - d) ** 1.6;
      const i = (y * size + x) * 4;
      if (buf[i + 3] === 0) continue;
      buf[i] = Math.round(buf[i] * (1 - a));
      buf[i + 1] = Math.round(buf[i + 1] * (1 - a));
      buf[i + 2] = Math.round(buf[i + 2] * (1 - a));
    }
  }
}

const TOP = '#2f4f8f';
const BOTTOM = '#16264d';

/**
 * @param {number} size
 * @param {boolean} maskable Android 用。四隅まで背景を敷き、ボールを中央80%の
 *   安全圏に収める（プラットフォームが円などに切り抜くため）
 */
function makeIcon(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  background(buf, size, TOP, BOTTOM, maskable ? 0 : 0.22, 0.18);
  // maskable は中央80%の円が安全圏。影とふちの分の余裕を見て 0.27 に抑える
  const R = size * (maskable ? 0.27 : 0.36);
  const cx = size / 2; const cy = size * 0.50;
  shadow(buf, size, cx, cy + R * 0.92, R * 1.05, R * 0.26, 0.30);
  ball(buf, size, cx, cy, R);
  return encodePng(size, size, buf);
}

mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`icons/icon-${size}.png`, makeIcon(size));
  console.log(`icons/icon-${size}.png を作りました`);
}
writeFileSync('icons/icon-maskable-512.png', makeIcon(512, true));
console.log('icons/icon-maskable-512.png を作りました');
