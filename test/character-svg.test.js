import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../js/core/characters.js';
import { characterSvg } from '../js/svg/character.js';

test('SVG文字列を返す', () => {
  const svg = characterSvg('hinoko', 0);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 100 100"'));
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('9体 × 3形態すべてが描画できる', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = characterSvg(c.id, stage);
      assert.ok(svg.length > 100, `${c.id} stage${stage} が短すぎる`);
      assert.ok(svg.startsWith('<svg'), `${c.id} stage${stage}`);
    }
  }
});

test('キャラ固有の色が使われる', () => {
  for (const c of CHARACTERS) {
    const svg = characterSvg(c.id, 0);
    assert.ok(svg.toLowerCase().includes(c.color.toLowerCase()), `${c.id} の色が使われていない`);
  }
});

test('形態ごとに見た目が変わる', () => {
  for (const c of CHARACTERS) {
    const s0 = characterSvg(c.id, 0);
    const s1 = characterSvg(c.id, 1);
    const s2 = characterSvg(c.id, 2);
    assert.notEqual(s0, s1, `${c.id}: 初期と第1進化が同じ`);
    assert.notEqual(s1, s2, `${c.id}: 第1進化と第2進化が同じ`);
  }
});

test('キャラごとに見た目が違う（同じ形態で比べて全部ユニーク）', () => {
  const svgs = CHARACTERS.map((c) => characterSvg(c.id, 1));
  assert.equal(new Set(svgs).size, CHARACTERS.length);
});

test('外部リソースを一切参照しない', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = characterSvg(c.id, stage).replace('http://www.w3.org/2000/svg', '');
      assert.ok(!svg.includes('http'), `${c.id} stage${stage}: 外部URL`);
      assert.ok(!svg.includes('<image'), `${c.id} stage${stage}: 画像参照`);
      assert.ok(!svg.includes('<script'), `${c.id} stage${stage}: スクリプト`);
    }
  }
});

test('silhouette は灰色だけで描く（キャラ色を出さない）', () => {
  const svg = characterSvg('kagero', 0, { silhouette: true });
  assert.ok(!svg.toLowerCase().includes('#6b5b95'));
  assert.ok(svg.includes('#b9b9c4'));
});

test('silhouette は全キャラ・全形態で灰色と輪郭のインク色以外の色を出さない', () => {
  // シルエット灰色と、共通骨格が使う目・口のインク色（黒っぽい輪郭・白目ハイライト）だけを許可する。
  // これ以外の16進カラーが1つでも出たら、PARTSのどこかに色がハードコードされている。
  const allowed = new Set(['#b9b9c4', '#2b2b33', '#ffffff']);
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = characterSvg(c.id, stage, { silhouette: true });
      const hexes = svg.match(/#[0-9a-fA-F]{6}/g) || [];
      for (const hex of hexes) {
        assert.ok(
          allowed.has(hex.toLowerCase()),
          `${c.id} stage${stage}: silhouette なのに想定外の色 ${hex} が出た`
        );
      }
    }
  }
});

test('size オプションで幅と高さが変わる', () => {
  const svg = characterSvg('hinoko', 0, { size: 240 });
  assert.ok(svg.includes('width="240"'));
  assert.ok(svg.includes('height="240"'));
});

test('未知のキャラIDは例外', () => {
  assert.throws(() => characterSvg('nazono', 0), /nazono/);
});

test('範囲外の形態は例外', () => {
  assert.throws(() => characterSvg('hinoko', 3), /stage/);
});
