import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decodePng, encodePng, prepareArt, alreadyTransparent, transparencyProfile,
} from '../tools/prepare-art.js';
import { ART } from '../js/svg/artManifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// =============================================================================
// 変換ツール（tools/prepare-art.js）そのものの回帰網。
//
// これまでの検査（test/png-art.test.js の A2〜A5）は「js/img に置かれた成果物」
// しか見ていなかった。成果物が全部緑でも、**ツールが次の1枚で事故る**ことは
// 止められない。実際に見つかった穴:
//
//  (1) 「もとから透過済み」の判定が四隅4画素だけだった。角丸マスクやビネットで
//      四隅だけ抜けている画像（背景は不透明のまま）を透過済みと誤判定して
//      背景除去を丸ごと飛ばし、灰色の四角に囲まれたキャラを出力する。
//      しかも A3(四隅透明)・A4(透明率20〜90%)・A5(彩度) は全部通ってしまう。
//  (2) 同じ判定が1画素で反転した。透明な角にゴミが1つ乗るだけで背景除去の
//      経路に入り、キャラの画素が黙って消える。
//
// 残り6体をこれから変換するので、成果物ではなくツールの側で止める。
// =============================================================================

/** 指定サイズの RGBA バッファに書く小さなヘルパ */
function makeCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  return {
    size,
    data,
    set(x, y, r, g, b, a) {
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    },
    toPng() { return encodePng(size, size, data); },
  };
}

/**
 * 「四隅だけ抜けているが背景は不透明」な画像。
 * 角丸マスク・ビネット・ぼかし背景で実際に起こる形。
 */
function roundedMaskFixture({ size = 512, radius = 40 } = {}) {
  const c = makeCanvas(size);
  const inCorner = (x, y) => {
    const cx = x < radius ? radius : (x >= size - radius ? size - 1 - radius : x);
    const cy = y < radius ? radius : (y >= size - radius ? size - 1 - radius : y);
    return Math.hypot(x - cx, y - cy) > radius;
  };
  const mid = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inCorner(x, y)) { c.set(x, y, 0, 0, 0, 0); continue; }
      // 中央に赤い円（キャラのつもり）、それ以外は不透明な灰色背景
      if (Math.hypot(x - mid, y - mid) < size * 0.22) c.set(x, y, 220, 40, 40, 255);
      else c.set(x, y, 150, 150, 150, 255);
    }
  }
  return c.toPng();
}

/** ふつうに透過済みの画像（縁は全部 alpha 0、中央に色のついた円） */
function transparentFixture({ size = 512 } = {}) {
  const c = makeCanvas(size);
  const mid = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (Math.hypot(x - mid, y - mid) < size * 0.3) c.set(x, y, 60, 150, 230, 255);
      else c.set(x, y, 130, 130, 130, 0); // 透明だがRGBには灰色のゴミが残っている
    }
  }
  return c.toPng();
}

/** 不透明かつ無彩色（灰色）な画素の割合をパーセントで返す */
function opaqueAchromaticRatio(img, satMax = 16) {
  const n = img.width * img.height;
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    if (img.data[i * 4 + 3] < 250) continue;
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) <= satMax) hit += 1;
  }
  return (hit / n) * 100;
}

// 出荷済み9枚の実測値は最大 4.88%（hinoko-0。ひのこは白目や灰色の影を持つ）。
// 角丸フィクスチャを素通りさせた場合は 61.5% になる。あいだを広く取って 20%。
const OPAQUE_GRAY_MAX = 20;

test('P1 角丸マスク（四隅だけ透明・背景は不透明）を「もとから透過済み」と誤判定しない', () => {
  const img = decodePng(roundedMaskFixture());
  const profile = transparencyProfile(img);
  assert.equal(
    alreadyTransparent(img), false,
    '四隅4画素だけを見る判定だと true になり、背景除去が丸ごと飛んでしまう'
    + `（縁リングの透明率 ${(profile.ringRatio * 100).toFixed(1)}%）`,
  );
});

test('P2 角丸マスクを変換しても、不透明な灰色の背景が残らない', () => {
  const { png, info } = prepareArt(roundedMaskFixture());
  assert.equal(info.removeBg, true, '背景除去が走っていない');
  const out = decodePng(png);
  const gray = opaqueAchromaticRatio(out);
  assert.ok(
    gray <= OPAQUE_GRAY_MAX,
    `不透明な無彩色の画素が ${gray.toFixed(1)}% 残っている`
    + `（灰色の四角に囲まれたキャラを出荷する事故。上限 ${OPAQUE_GRAY_MAX}%）`,
  );
});

test('P3 透明な縁に1画素ゴミが乗っても「もとから透過済み」の判定が反転しない', () => {
  const base = decodePng(transparentFixture());
  assert.equal(alreadyTransparent(base), true, '前提: ふつうの透過画像は透過済みと判定される');

  // 左上の1画素だけ alpha を 0 → 1 にする（生成画像に実際に残っていたゴミと同じ）
  const dirty = decodePng(transparentFixture());
  dirty.data[3] = 1;
  assert.equal(
    alreadyTransparent(dirty), true,
    '1画素で判定が反転すると、黙って背景除去の経路に入りキャラの画素が消える',
  );
});

test('P4 もとから透過済みの画像は背景除去を通さない（透明画素のRGBのゴミを背景色として学習しない）', () => {
  const { info } = prepareArt(transparentFixture());
  assert.equal(info.preTransparent, true);
  assert.equal(info.removeBg, false, 'もう透明なのだから消す必要はない');
});

test('P5 --force-remove-bg 相当（forceRemoveBg）を渡せば、透過済みでも背景除去を通せる', () => {
  const { info } = prepareArt(transparentFixture(), { forceRemoveBg: true });
  assert.equal(info.preTransparent, true, '判定そのものは透過済みのまま');
  assert.equal(info.removeBg, true, '明示的に指定したときは除去を走らせる');
});

test('P6 出荷済みの画像に、不透明な無彩色の大きな塊が残っていない', () => {
  for (const [charId, stages] of Object.entries(ART)) {
    for (const stage of stages) {
      const path = join(ROOT, 'js', 'img', `${charId}-${stage}.png`);
      const img = decodePng(readFileSync(path));
      const gray = opaqueAchromaticRatio(img);
      assert.ok(
        gray <= OPAQUE_GRAY_MAX,
        `${charId}-${stage}.png: 不透明な無彩色の画素が ${gray.toFixed(1)}%`
        + `（背景が残っている疑い。上限 ${OPAQUE_GRAY_MAX}%）`,
      );
    }
  }
});
