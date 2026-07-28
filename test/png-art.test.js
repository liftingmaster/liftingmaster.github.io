import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { ART, artPath } from '../js/svg/artManifest.js';
import { CHARACTERS } from '../js/core/characters.js';
import {
  decodePng, transparentRatio, cornerAlphas, averageColorInAlphaBand, saturation,
} from './helpers/decode-png.js';

/**
 * ART（js/svg/artManifest.js）に載っているキャラの画像ファイル自体を検査する。
 *
 * 「キャラ固有の色が使われる」テストからひのこ（画像キャラ）を外したのは正しい
 * 判断だったが、それだけでは「PNGが0バイト」「壊れて途中で切れている」
 * 「2つの形態が誤って同じファイルのコピーになっている」といった事故を
 * 何も検知しなくなる。ここでその代わりをする。
 *
 * 画像ライブラリは使わず、node:fs だけで PNG のヘッダ（シグネチャ + IHDR）を
 * 読む。IHDR の中身を細かく解釈する参考実装は tools/inspect-art.js にある。
 *
 * ART に新しいキャラを足すたびに、このテストが自動でそのキャラも検査する。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** シグネチャ確認のうえ、IHDRから width/height を読む */
function readPngHeader(buf) {
  assert.ok(buf.length > 8, 'ファイルが短すぎてPNGシグネチャすら無い');
  assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), 'PNGシグネチャで始まっていない');
  // signature(8) + IHDR length(4) + type(4) = 16 バイト目から width/height（各4バイトBE）
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function filePath(charId, stage) {
  // artPath は index.html から見た相対パス（'./js/img/xxx.png'）を返すので、
  // リポジトリルートから読むために先頭の './' を取り除く
  return artPath(charId, stage).replace(/^\.\//, '');
}

test('ART に載っている画像はすべて存在し、空ではない', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const stat = statSync(path, { throwIfNoEntry: false });
      assert.ok(stat, `${path}: ファイルが無い`);
      assert.ok(stat.size > 0, `${path}: 0バイト`);
    }
  }
});

test('ART に載っている画像はPNGシグネチャで始まり、正方形', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const buf = readFileSync(path);
      const { width, height } = readPngHeader(buf);
      assert.ok(width > 0 && height > 0, `${path}: width/heightが0`);
      assert.equal(width, height, `${path}: 正方形ではない（${width}x${height}）`);
    }
  }
});

test('同じキャラの形態ごとのPNGは、それぞれ別のファイル（コピペ事故の検知）', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    const buffers = stages.map((stage) => readFileSync(filePath(charId, stage)));
    for (let i = 0; i < buffers.length; i += 1) {
      for (let j = i + 1; j < buffers.length; j += 1) {
        assert.ok(
          !buffers[i].equals(buffers[j]),
          `${charId}: stage${stages[i]} と stage${stages[j]} が同一ファイル`,
        );
      }
    }
  }
});

// --- ここから、しずく・はっぱの元画像差し替え（本タスク）で追加した検査 ---
//
// 上の3テストは「ファイルとして壊れていないか」だけを見ている。
// tools/prepare-art.js の背景除去・512x512化がキャラごとに正しく効いているかは
// 実際にPNGの画素（RGBA）をデコードしないと分からない。ここから先は
// test/helpers/decode-png.js を使って、生成された512px画像の中身を検査する。
//
// そのヘルパーは tools/prepare-art.js の decodePng を再輸出しているだけ
// （以前は「CLI なので import できない」として複製していたが、
// ライブラリ部とCLI部を分けた時点でその理由は無くなった。詳細はヘルパー冒頭）。
// デコーダを共有しているぶん、ここで見ているのは「変換ツールの出力が
// 意図どおりか」であって「デコーダ自体が正しいか」ではない点に注意。

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

/** #rrggbb を [r,g,b] にする */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] の中で最大のチャンネルの添字（0=R,1=G,2=B） */
function dominantChannel([r, g, b]) {
  if (r >= g && r >= b) return 0;
  if (g >= r && g >= b) return 1;
  return 2;
}

const CHANNEL_NAME = ['R', 'G', 'B'];

test('A2: ART に載っている画像はすべて512x512である', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const { width, height } = readPngHeader(readFileSync(path));
      assert.equal(width, 512, `${path}: 幅が512ではない（${width}）`);
      assert.equal(height, 512, `${path}: 高さが512ではない（${height}）`);
    }
  }
});

test('A3: ART に載っている画像はアルファチャンネルを持ち、四隅が透明（alpha=0）', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const img = decodePng(readFileSync(path));
      assert.ok(img.hasAlpha, `${path}: アルファチャンネルを持たない`);
      const corners = cornerAlphas(img);
      for (const [name, alpha] of Object.entries(corners)) {
        assert.equal(alpha, 0, `${path}: 四隅(${name})が透明ではない（alpha=${alpha}）`);
      }
    }
  }
});

// A4: 透明率の妥当な範囲。
//
// 下限・上限は、既にひのこで実測済みの値（hinoko-0が59%, hinoko-1が67%,
// hinoko-2が60%）を基準に、上下へゆるく振っただけの数値。狙いは2つの事故を
// 両方まとめて捕まえること:
//   - 下限20%: 背景除去がほぼ効かず、四角い背景がそのまま残っている事故
//     （実測60%前後より40ポイント近く低い時点でおかしいと分かる）
//   - 上限90%: 背景除去が効きすぎてキャラの本体まで透過され、輪郭線しか
//     残らない・実質消えている事故（実測60%前後より30ポイント近く高い）
// ひのこの実測3点はどれもこの範囲の中央付近に収まる。
const TRANSPARENT_RATIO_MIN = 20;
const TRANSPARENT_RATIO_MAX = 90;

test('A4: ART に載っている画像の透明率が妥当な範囲（20%〜90%）にある', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const img = decodePng(readFileSync(path));
      const ratio = transparentRatio(img);
      assert.ok(
        ratio >= TRANSPARENT_RATIO_MIN,
        `${path}: 透明率が${ratio.toFixed(1)}%で低すぎる（背景が残っている疑い。下限${TRANSPARENT_RATIO_MIN}%）`,
      );
      assert.ok(
        ratio <= TRANSPARENT_RATIO_MAX,
        `${path}: 透明率が${ratio.toFixed(1)}%で高すぎる（キャラ本体まで消えている疑い。上限${TRANSPARENT_RATIO_MAX}%）`,
      );
    }
  }
});

// A5: 輪郭に灰色の縁取りが出ていないか。
//
// 2つの角度から見る。どちらも「元画像で灰色混入0〜3%だった水準を、変換後も
// 保っているべき」という前提から逆算した、ゆるいしきい値。
//
//  (1) 不透明部分（alpha>=250）の平均色が、そのキャラの定義色（characters.js の
//      color）と同じチャンネルが最大になっている。しずくなら水色（B最大）、
//      はっぱなら緑（G最大）が保たれているかの直接チェック。背景の混入や
//      キャラ取り違えで色相が大きく傾けば、ここで真っ先に崩れる。
//  (2) 不透明部分の彩度（max-min）が十分にある（今回渡された元画像6枚の
//      ふちの色で見ると、最も彩度が低いのは happa-2（RGB(110,133,122),
//      彩度23）。それでも無彩色の背景色（彩度<=16の許容幅、
//      tools/prepare-art.js の satPad 相当）とは一線を画すため、ここでは
//      さらにゆるく「彩度10以上」を下限にする。もし背景が塗り残って
//      不透明のまま混ざれば、平均色は急激に無彩色（彩度0付近）へ寄る。
test('A5: 不透明部分の平均色が、キャラ定義色と同じチャンネルで最大になっている（色相の取り違え・背景混入の検知）', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    const char = BY_ID.get(charId);
    assert.ok(char, `${charId}: js/core/characters.js に定義が無い`);
    const expected = dominantChannel(hexToRgb(char.color));
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const img = decodePng(readFileSync(path));
      const opaque = averageColorInAlphaBand(img, 250, 255);
      assert.ok(opaque, `${path}: 不透明画素が1つも無い`);
      const got = dominantChannel([opaque.r, opaque.g, opaque.b]);
      assert.equal(
        got, expected,
        `${path}: 不透明部分の平均色が ${CHANNEL_NAME[got]} 最大だが、`
        + `キャラ定義色（${char.color}）は ${CHANNEL_NAME[expected]} 最大のはず`
        + ` (avg r=${opaque.r.toFixed(0)} g=${opaque.g.toFixed(0)} b=${opaque.b.toFixed(0)})`,
      );
      assert.ok(
        saturation(opaque) >= 10,
        `${path}: 不透明部分の彩度が${saturation(opaque).toFixed(1)}で低すぎる（無彩色に寄っている＝背景混入の疑い）`,
      );
    }
  }
});

// A5(2): 半透明の輪郭（alpha 20〜249）が、完全な無彩色（灰色）になり切って
// いないこと。ひのこの実測では、この帯の彩度は不透明部分の彩度の 6%〜22%
// まで落ち込む（アンチエイリアスで暗く・薄くなるほど、素の色を割り算で
// 復元する際にどうしても彩度が失われるため。これは正常な現象であり、
// 縁取りが「灰色一色」に固定されているのとは別物）。
// ここでは「灰色一色に落ち切っていないか」だけをゆるく見る下限として、
// ひのこの実測最小値（6.1%）よりもさらに低い 2% を採用する。
const FRINGE_SATURATION_RATIO_MIN = 0.02;

test('A5(2): 半透明の輪郭が完全な無彩色（灰色一色）に落ち切っていない', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = filePath(charId, stage);
      const img = decodePng(readFileSync(path));
      const opaque = averageColorInAlphaBand(img, 250, 255);
      const semi = averageColorInAlphaBand(img, 20, 249);
      if (!semi) continue; // アンチエイリアスの帯が無い（境界がすべて完全透明/不透明）なら対象外
      const opaqueSat = saturation(opaque);
      const semiSat = saturation(semi);
      const ratio = opaqueSat > 0 ? semiSat / opaqueSat : 0;
      assert.ok(
        ratio >= FRINGE_SATURATION_RATIO_MIN,
        `${path}: 半透明の輪郭の彩度比が${(ratio * 100).toFixed(1)}%まで落ちている`
        + `（灰色一色の縁取りの疑い。下限${FRINGE_SATURATION_RATIO_MIN * 100}%）`,
      );
    }
  }
});
