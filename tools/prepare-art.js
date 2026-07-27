/**
 * 生成AIで作ったキャラ画像を、アプリで使える形に整える道具。
 *
 *   1. PNG を読む（依存ゼロ。zlib だけで自前デコード）
 *   2. 背景を透過にする（縁からの塗りつぶし方式）
 *   3. 余白を整えて 512x512 に縮小する
 *   4. PNG で書き出す
 *
 * 使い方:
 *   node tools/prepare-art.js incoming-art/hinoko-1.png.png js/img/hinoko-0.png
 *
 * 背景除去は「縁とつながっている、背景らしい色」だけを消す。
 * キャラの内側にある同系色（目の白、影の灰色など）は縁とつながっていないので残る。
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------- PNG デコード ----------

function readChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    chunks.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 8bit の RGB / RGBA / グレースケール（非インターレース）を RGBA の生バイトにする */
function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (depth !== 8) throw new Error(`ビット深度 ${depth} は未対応（8のみ）`);
  if (interlace !== 0) throw new Error('インターレースPNGは未対応');
  const srcChannels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!srcChannels) throw new Error(`カラータイプ ${colorType} は未対応`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);

  const bpp = srcChannels;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;

    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    prev = line;

    for (let x = 0; x < width; x += 1) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      if (colorType === 6) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = line[s + 3];
      } else if (colorType === 2) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = 255;
      } else if (colorType === 0) {
        out[d] = line[s]; out[d + 1] = line[s]; out[d + 2] = line[s]; out[d + 3] = 255;
      } else {
        out[d] = line[s]; out[d + 1] = line[s]; out[d + 2] = line[s]; out[d + 3] = line[s + 1];
      }
    }
  }
  return { width, height, data: out };
}

// ---------- PNG エンコード ----------

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 背景除去 ----------

/** 縁のリングを見て、背景の色の範囲を測る */
function sampleBorder(img) {
  const { width, height, data } = img;
  const lums = [];
  const sats = [];
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    lums.push(mx); sats.push(mx - mn);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  lums.sort((a, b) => a - b);
  sats.sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)];
  return {
    lumMin: q(lums, 0.01), lumMax: q(lums, 0.99),
    satMax: q(sats, 0.99),
  };
}

/**
 * 縁からつながっている「背景らしい」画素の alpha を 0 にする。
 * 完全に背景 → 0 / 完全に前景 → 255 / 中間（輪郭のぼかし）→ その間
 */
function removeBackground(img, bg, keepEnclosed) {
  const { width, height, data } = img;
  const n = width * height;
  const lumPad = 26;   // 背景の明るさの許容幅
  const satPad = 16;   // 背景は無彩色に近いという前提の許容幅
  const hardLum = [bg.lumMin - lumPad, bg.lumMax + lumPad];
  const hardSat = bg.satMax + satPad;
  const softLum = [hardLum[0] - 22, hardLum[1] + 22];
  const softSat = hardSat + 22;

  const score = (i) => {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    const sat = mx - mn;
    if (mx >= hardLum[0] && mx <= hardLum[1] && sat <= hardSat) return 1;      // 確実に背景
    if (mx >= softLum[0] && mx <= softLum[1] && sat <= softSat) return 0.5;    // 境界のぼかし
    return 0;
  };

  const state = new Uint8Array(n); // 0=未判定 1=背景 2=境界
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (state[p] !== 0) return;
    const s = score(p * 4);
    if (s === 1) { state[p] = 1; stack.push(p); }
    else if (s === 0.5) { state[p] = 2; }   // 境界で止める（先へは進まない）
  };

  for (let x = 0; x < width; x += 1) { pushIf(x, 0); pushIf(x, height - 1); }
  for (let y = 0; y < height; y += 1) { pushIf(0, y); pushIf(width - 1, y); }

  while (stack.length > 0) {
    const p = stack.pop();
    const x = p % width; const y = (p - x) / width;
    pushIf(x - 1, y); pushIf(x + 1, y); pushIf(x, y - 1); pushIf(x, y + 1);
  }

  // 縁からたどり着けなかった背景の塊も消す。
  //
  // 炎の光が背景と混ざると、灰色がわずかに色を帯びる（彩度20〜60）。この部分は
  // 炎の輪郭に囲まれて縁とつながらないため、連結と厳しい色判定だけでは残ってしまう。
  // そこで色の条件をゆるめたうえで、「**囲まれた大きなかたまり**」だけを消す。
  // 輪郭線のふちや影のような細い灰色は面積が小さいので残る。
  // ※ 意図的に無彩色の中間調を持つキャラでは絵が欠ける恐れがある。
  //    --keep-enclosed で無効にできる。
  const loose = (i) => {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    return mx - mn <= 60 && mx >= 100 && mx <= 205;
  };
  const minBlob = Math.round(n * 0.0015);   // 画面の0.15%より大きい塊を背景とみなす
  let enclosed = 0;
  if (!keepEnclosed) {
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start += 1) {
      if (seen[start] || state[start] !== 0 || !loose(start * 4)) continue;
      const blob = [];
      const q = [start];
      seen[start] = 1;
      while (q.length > 0) {
        const p = q.pop();
        blob.push(p);
        const x = p % width; const y = (p - x) / width;
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (seen[np] || state[np] !== 0 || !loose(np * 4)) continue;
          seen[np] = 1; q.push(np);
        }
      }
      if (blob.length >= minBlob) {
        for (const p of blob) state[p] = 1;
        enclosed += blob.length;
      }
    }
  }

  let removed = 0;
  let soft = 0;
  for (let p = 0; p < n; p += 1) {
    if (state[p] === 1) { data[p * 4 + 3] = 0; removed += 1; }
    else if (state[p] === 2) { data[p * 4 + 3] = 128; soft += 1; }
  }
  return { removed, soft, enclosed, total: n };
}

// ---------- 余白調整と縮小 ----------

function opaqueBounds(img, threshold = 24) {
  const { width, height, data } = img;
  let minX = width; let maxX = -1; let minY = height; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, empty: maxX < 0 };
}

/** 被写体を中央に置いた正方形へ切り出し、面積平均で size に縮小する */
function fitSquare(img, bounds, size, marginRatio = 0.08) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * (1 + marginRatio * 2);
  const half = side / 2;
  const out = Buffer.alloc(size * size * 4);
  const scale = side / size;

  for (let oy = 0; oy < size; oy += 1) {
    for (let ox = 0; ox < size; ox += 1) {
      const sx0 = cx - half + ox * scale;
      const sy0 = cy - half + oy * scale;
      let r = 0; let g = 0; let b = 0; let a = 0; let count = 0;
      const stepMax = Math.max(1, Math.floor(scale));
      for (let dy = 0; dy < stepMax; dy += 1) {
        for (let dx = 0; dx < stepMax; dx += 1) {
          const sx = Math.round(sx0 + dx);
          const sy = Math.round(sy0 + dy);
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) { count += 1; continue; }
          const i = (sy * img.width + sx) * 4;
          const al = img.data[i + 3] / 255;
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al;
          a += img.data[i + 3];
          count += 1;
        }
      }
      const d = (oy * size + ox) * 4;
      const aAvg = a / count;
      // 事前乗算した色を戻す。こうしないと縁に背景色がにじむ
      const inv = aAvg > 0 ? 255 / a : 0;
      out[d] = Math.min(255, Math.round(r * inv));
      out[d + 1] = Math.min(255, Math.round(g * inv));
      out[d + 2] = Math.min(255, Math.round(b * inv));
      out[d + 3] = Math.round(aAvg);
    }
  }
  return { width: size, height: size, data: out };
}

// ---------- 実行 ----------

const args = process.argv.slice(2);
const keepEnclosed = args.includes('--keep-enclosed');
const [src, dest, sizeArg] = args.filter((a) => !a.startsWith('--'));
if (!src || !dest) {
  console.error('usage: node tools/prepare-art.js <input.png> <output.png> [size=512] [--keep-enclosed]');
  process.exit(2);
}
const size = Number(sizeArg) || 512;

const img = decodePng(readFileSync(src));
const bg = sampleBorder(img);
const stats = removeBackground(img, bg, keepEnclosed);
const bounds = opaqueBounds(img);
if (bounds.empty) throw new Error('全部が背景と判定されました。除去の条件が広すぎます');
const fitted = fitSquare(img, bounds, size);
mkdirSync(dirname(dest), { recursive: true });
const out = encodePng(fitted.width, fitted.height, fitted.data);
writeFileSync(dest, out);

const pct = (v) => `${((v / stats.total) * 100).toFixed(1)}%`;
console.log(`${src} -> ${dest}`);
console.log(`  もとの大きさ : ${img.width}x${img.height}`);
console.log(`  背景の色域   : 明るさ ${bg.lumMin}-${bg.lumMax} / 彩度 <=${bg.satMax}`);
console.log(`  透過にした   : ${pct(stats.removed)}（境界のぼかし ${pct(stats.soft)}）`);
console.log(`  うち囲まれた分: ${pct(stats.enclosed)}${keepEnclosed ? '（--keep-enclosed のため未除去）' : ''}`);
console.log(`  残った被写体 : X ${bounds.minX}-${bounds.maxX} / Y ${bounds.minY}-${bounds.maxY}`);
console.log(`  書き出し     : ${size}x${size} / ${(out.length / 1024).toFixed(0)}KB`);
