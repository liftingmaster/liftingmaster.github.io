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

/** 境界を1.5pxぼかした円 */
function circle(buf, w, h, cx, cy, r, color) {
  const c = hex(color);
  const x0 = Math.max(0, Math.floor(cx - r - 2));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 2));
  const y0 = Math.max(0, Math.floor(cy - r - 2));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 2));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(buf, w, x, y, c, Math.min(1, (r - d) / 1.5 + 0.5));
    }
  }
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  // 背景（角丸の四角）
  const bg = hex('#4a90d9');
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x, x - (size - radius), 0);
      const dy = Math.max(radius - y, y - (size - radius), 0);
      const d = Math.hypot(dx, dy);
      blend(buf, size, x, y, bg, Math.min(1, (radius - d) / 1.5 + 0.5));
    }
  }
  // ボール
  const c = size / 2;
  circle(buf, size, size, c, c * 1.02, size * 0.30, '#ffffff');
  const spot = size * 0.062;
  circle(buf, size, size, c, c * 1.02, spot * 1.15, '#2b2b33');
  for (let i = 0; i < 5; i += 1) {
    const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    circle(buf, size, size, c + Math.cos(ang) * size * 0.20, c * 1.02 + Math.sin(ang) * size * 0.20, spot, '#2b2b33');
  }
  return encodePng(size, size, buf);
}

mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`icons/icon-${size}.png`, makeIcon(size));
  console.log(`icons/icon-${size}.png を作りました`);
}
