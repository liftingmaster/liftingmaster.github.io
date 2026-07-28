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
 *
 * **もとから透過済みの画像**（四隅の alpha が 0）は、背景除去を通さない。
 * 判定は RGB だけを見ていて alpha を見ないため、透明画素に残っているゴミの色
 * （書き出し元によって灰色だったり白だったりする）を「背景の色」として学習し、
 * キャラの中の同系色まで削ってしまう。もう透明なのだから消す必要もない。
 * どうしても通したいときは --force-remove-bg を付ける。
 *
 * このファイルは CLI としても、テストや他のツールからの import としても使える
 * （実行時だけ下の「実行」節が走る）。
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function decodePng(buf) {
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
  return {
    width, height, data: out, hasAlpha: colorType === 6 || colorType === 4,
  };
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

export function encodePng(width, height, rgba) {
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
  const cols = new Int32Array(width);
  const rows = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) { cols[x] += 1; rows[y] += 1; }
    }
  }

  // 1列/1行あたり何画素あれば「被写体がそこにある」と見なすか。
  //
  // 生成画像には、本体から離れたところに数画素だけ薄いゴミが残っていることがある
  // （実測: shizuku-2_png.png の x=0 に alpha 39 の点が2つ）。素直に最小/最大を
  // 取ると、その1点のせいで切り出しの中心が 235px もずれ、キャラが片寄る。
  // 端の列を落とす基準を「その辺の長さの 0.25%（2048px なら約5画素）」にして、
  // 出力512pxでは1〜2px にしかならない極細のゴミだけを無視する。
  // 本物のしっぽの先やアンテナは、ふつうこれより太い。
  const minRun = (len) => Math.max(3, Math.round(len * 0.0025));
  const colMin = minRun(height);
  const rowMin = minRun(width);

  const firstIndex = (arr, need) => {
    for (let i = 0; i < arr.length; i += 1) if (arr[i] >= need) return i;
    return -1;
  };
  const lastIndex = (arr, need) => {
    for (let i = arr.length - 1; i >= 0; i -= 1) if (arr[i] >= need) return i;
    return -1;
  };

  let minX = firstIndex(cols, colMin);
  let maxX = lastIndex(cols, colMin);
  let minY = firstIndex(rows, rowMin);
  let maxY = lastIndex(rows, rowMin);

  // しきい値で全部落ちてしまった（極端に小さい被写体）ときは、素の最小/最大に戻す
  if (minX < 0 || minY < 0) {
    minX = firstIndex(cols, 1); maxX = lastIndex(cols, 1);
    minY = firstIndex(rows, 1); maxY = lastIndex(rows, 1);
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

// ---------- 変換の本体（CLI からもテストからも使える） ----------

/**
 * 「もとから透過済み」の画像か。四隅4画素だけでは足りない。
 *
 * 四隅だけを見ると、**角丸マスクやビネットで四隅だけ抜けている画像**
 * （＝背景は不透明のまま残っている）を透過済みと誤判定し、背景除去を飛ばして
 * 灰色の四角に囲まれたキャラを出力してしまう。逆に1画素でもゴミが乗ると
 * 判定が反転し、黙って背景除去の経路に入ってキャラを削る
 * （実測: shizuku-1 の (0,0) を alpha 1 にすると alpha>200 の画素が960個消える）。
 *
 * そこで2つを AND で見る:
 *   - 縁1リングのほぼ全部（99.5%以上）が alpha 0 … 角丸・ビネットを弾く
 *   - 画像全体の 5% 以上が alpha 0        … 念のための下限
 * リングに数画素のゴミが乗っても 99.5% は割らないので、判定は1画素で反転しない。
 */
export function transparencyProfile(img) {
  const { width, height, data } = img;
  const at = (x, y) => data[(y * width + x) * 4 + 3];

  let ringTotal = 0;
  let ringClear = 0;
  const countRing = (x, y) => { ringTotal += 1; if (at(x, y) === 0) ringClear += 1; };
  for (let x = 0; x < width; x += 1) { countRing(x, 0); countRing(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { countRing(0, y); countRing(width - 1, y); }

  let clear = 0;
  const n = width * height;
  for (let i = 0; i < n; i += 1) if (data[i * 4 + 3] === 0) clear += 1;

  const ringRatio = ringTotal > 0 ? ringClear / ringTotal : 0;
  const overallRatio = clear / n;
  return {
    ringRatio,
    overallRatio,
    preTransparent: ringRatio >= 0.995 && overallRatio >= 0.05,
  };
}

/** もとから透過済みか（判定の詳細は transparencyProfile を参照） */
export function alreadyTransparent(img) {
  return transparencyProfile(img).preTransparent;
}

/**
 * 元画像のバッファを、アプリで使う size x size の PNG バッファへ変換する。
 * @returns {{ png: Buffer, info: object }}
 */
export function prepareArt(srcBuffer, { size = 512, keepEnclosed = false, forceRemoveBg = false } = {}) {
  const img = decodePng(srcBuffer);
  const profile = transparencyProfile(img);
  const preTransparent = profile.preTransparent;
  const removeBg = forceRemoveBg || !preTransparent;

  let bg = null;
  let stats = null;
  if (removeBg) {
    bg = sampleBorder(img);
    stats = removeBackground(img, bg, keepEnclosed);
  }

  const bounds = opaqueBounds(img);
  if (bounds.empty) throw new Error('全部が背景と判定されました。除去の条件が広すぎます');
  const fitted = fitSquare(img, bounds, size);
  return {
    png: encodePng(fitted.width, fitted.height, fitted.data),
    info: {
      width: img.width,
      height: img.height,
      preTransparent,
      profile,
      removeBg,
      bg,
      stats,
      bounds,
      size,
    },
  };
}

// ---------- 実行（CLI として起動されたときだけ） ----------

function main() {
  const args = process.argv.slice(2);
  const KNOWN_FLAGS = new Set(['--keep-enclosed', '--force-remove-bg']);
  // 打ち間違えた旗（--force-remove-bgg など）を黙って無視すると、
  // 意図した処理をしていないのに正常終了して見分けがつかない
  const unknown = args.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    console.error(`しらない オプション: ${unknown.join(' ')}`);
    console.error(`つかえるのは: ${[...KNOWN_FLAGS].join(' ')}`);
    process.exit(2);
  }
  const keepEnclosed = args.includes('--keep-enclosed');
  const forceRemoveBg = args.includes('--force-remove-bg');
  const [src, dest, sizeArg] = args.filter((a) => !a.startsWith('--'));
  if (!src || !dest) {
    console.error('usage: node tools/prepare-art.js <input.png> <output.png> [size=512] [--keep-enclosed] [--force-remove-bg]');
    process.exit(2);
  }
  const size = Number(sizeArg) || 512;

  const { png, info } = prepareArt(readFileSync(src), { size, keepEnclosed, forceRemoveBg });
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, png);

  console.log(`${src} -> ${dest}`);
  console.log(`  もとの大きさ : ${info.width}x${info.height}`);
  if (info.removeBg) {
    const pct = (v) => `${((v / info.stats.total) * 100).toFixed(1)}%`;
    console.log(`  背景の色域   : 明るさ ${info.bg.lumMin}-${info.bg.lumMax} / 彩度 <=${info.bg.satMax}`);
    console.log(`  透過にした   : ${pct(info.stats.removed)}（境界のぼかし ${pct(info.stats.soft)}）`);
    console.log(`  うち囲まれた分: ${pct(info.stats.enclosed)}${keepEnclosed ? '（--keep-enclosed のため未除去）' : ''}`);
  } else {
    console.log('  背景除去     : していない（もとから透過済み。元の alpha をそのまま使う）');
  }
  console.log(`  透過の判定   : 縁リングの透明率 ${(info.profile.ringRatio * 100).toFixed(2)}%（>=99.5%が条件）`
    + ` / 全体の透明率 ${(info.profile.overallRatio * 100).toFixed(1)}%（>=5%が条件）`
    + ` → もとから透過済み=${info.preTransparent}${forceRemoveBg ? ' / --force-remove-bg 指定あり' : ''}`);
  console.log(`  残った被写体 : X ${info.bounds.minX}-${info.bounds.maxX} / Y ${info.bounds.minY}-${info.bounds.maxY}`);
  console.log(`  書き出し     : ${info.size}x${info.size} / ${(png.length / 1024).toFixed(0)}KB`);
}

// import されたときは実行しない（テストランナーが落ちるため）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
