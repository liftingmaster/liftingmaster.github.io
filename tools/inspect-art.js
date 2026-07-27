/**
 * 取り込み後の画像に、背景の残りらしい画素がどこにどれだけあるかを調べる道具。
 *   node tools/inspect-art.js js/img/hinoko-2.png
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    chunks.push({ type: buf.toString('ascii', p + 4, p + 8), data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const paeth = (a, b, c) => {
    const q = a + b - c; const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  const stride = width * 4;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride); let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const f = raw[pos]; pos += 1;
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0; const b = prev[i]; const c = i >= 4 ? prev[i - 4] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    prev = line; line.copy(out, y * stride);
  }
  return { width, height, data: out };
}

const file = process.argv[2];
const { width, height, data } = decodePng(readFileSync(file));

// 不透明に残っている画素を、彩度と明るさで分類する
const buckets = new Map();
let opaque = 0;
for (let i = 0; i < width * height; i += 1) {
  if (data[i * 4 + 3] < 200) continue;
  opaque += 1;
  const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2];
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  const sat = mx - mn;
  const key = `sat ${Math.floor(sat / 20) * 20}-${Math.floor(sat / 20) * 20 + 19} / lum ${Math.floor(mx / 32) * 32}-${Math.floor(mx / 32) * 32 + 31}`;
  buckets.set(key, (buckets.get(key) || 0) + 1);
}

console.log(`${file}  不透明画素 ${opaque}`);
console.log('多い順に上位12種:');
[...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${((v / opaque) * 100).toFixed(1)}%`));

// 低彩度の中間調＝背景の残りらしいものが、どこに固まっているか
let minX = width; let maxX = -1; let minY = height; let maxY = -1; let count = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) continue;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    if (mx - mn <= 45 && mx >= 90 && mx <= 205) {
      count += 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
if (count === 0) console.log('低彩度の中間調: なし');
else {
  console.log(`低彩度の中間調(彩度<=45, 明るさ90-205): ${((count / opaque) * 100).toFixed(1)}%`);
  console.log(`  かたまりの範囲: X ${minX}-${maxX} / Y ${minY}-${maxY}（画像は ${width}x${height}）`);
}
