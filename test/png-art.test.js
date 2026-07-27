import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { ART, artPath } from '../js/svg/artManifest.js';

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
