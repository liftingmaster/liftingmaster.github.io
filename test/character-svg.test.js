import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../js/core/characters.js';
import { characterSvg } from '../js/svg/character.js';
import { svgExtents } from './helpers/svg-extents.js';

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

test('silhouette は aria-label にも本名を出さない（未所持キャラの名前が読み上げられないように）', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = characterSvg(c.id, stage, { silhouette: true });
      assert.ok(
        !svg.includes(c.name),
        `${c.id} stage${stage}: silhouette なのに aria-label 等に本名 "${c.name}" が出た`
      );
      assert.ok(svg.includes('aria-label="みかいほうの キャラクター"'), `${c.id} stage${stage}`);
    }
  }
});

test('silhouette ではない通常表示は aria-label に本名を出す（既存動作の維持）', () => {
  for (const c of CHARACTERS) {
    const svg = characterSvg(c.id, 0);
    assert.ok(svg.includes(`aria-label="${c.name}"`), `${c.id}: 通常表示で本名が aria-label に出ていない`);
  }
});

test('size オプションで幅と高さが変わる', () => {
  const svg = characterSvg('hinoko', 0, { size: 240 });
  assert.ok(svg.includes('width="240"'));
  assert.ok(svg.includes('height="240"'));
});

// --- viewBox からのはみ出し（第2進化の足先が切れていた不具合の再発防止） ---
//
// BODY の体格表で bodyY + bodyRy - 2 + legLen（足の裏）が 100 を超えると、
// 全キャラの最終形態の足先が切れる。実際に第2進化は 62+27-2+16 = 103 だった。
// 体格表だけでなく、キャラ固有パーツ（PARTS）の座標も同じ箱に収まっている必要がある。

test('9体×3形態のどの図形も viewBox（0..100）からはみ出さない', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const shapes = svgExtents(characterSvg(c.id, stage));
      assert.ok(shapes.length > 0, `${c.id} stage${stage}: 図形が1つも取れていない`);
      for (const s of shapes) {
        const where = `${c.id} stage${stage} <${s.kind}>`;
        assert.ok(s.minX >= 0, `${where}: 左に ${(-s.minX).toFixed(1)} はみ出している`);
        assert.ok(s.minY >= 0, `${where}: 上に ${(-s.minY).toFixed(1)} はみ出している`);
        assert.ok(s.maxX <= 100, `${where}: 右に ${(s.maxX - 100).toFixed(1)} はみ出している`);
        assert.ok(s.maxY <= 100, `${where}: 下に ${(s.maxY - 100).toFixed(1)} はみ出している（足先が切れる）`);
      }
    }
  }
});

test('シルエット表示でも viewBox からはみ出さない', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      for (const s of svgExtents(characterSvg(c.id, stage, { silhouette: true }))) {
        assert.ok(
          s.minX >= 0 && s.minY >= 0 && s.maxX <= 100 && s.maxY <= 100,
          `${c.id} stage${stage} silhouette <${s.kind}> がはみ出している`
        );
      }
    }
  }
});

test('形態が進むほど大きくなる（足の裏・体の幅・足の長さ）', () => {
  // 第2進化を viewBox に収める調整で、第1進化より小さくなっていないことを見る。
  // 体の幅（bodyRx*2）はいちばん外側の rect（足）ではなく、体の ellipse の幅で見る。
  const bodyWidth = (stage) => {
    const ellipses = svgExtents(characterSvg('hinoko', stage)).filter((s) => s.kind === 'ellipse');
    return Math.max(...ellipses.map((s) => s.maxX - s.minX));
  };
  const feet = (stage) => Math.max(
    ...svgExtents(characterSvg('hinoko', stage)).filter((s) => s.kind === 'rect').map((s) => s.maxY)
  );
  const legLength = (stage) => Math.max(
    ...svgExtents(characterSvg('hinoko', stage)).filter((s) => s.kind === 'rect').map((s) => s.maxY - s.minY)
  );

  assert.ok(bodyWidth(0) < bodyWidth(1), '体が 初期 → 第1進化 で大きくなっていない');
  assert.ok(bodyWidth(1) < bodyWidth(2), '体が 第1進化 → 第2進化 で大きくなっていない');
  assert.ok(legLength(0) < legLength(1), '足が 初期 → 第1進化 で長くなっていない');
  assert.ok(legLength(1) < legLength(2), '足が 第1進化 → 第2進化 で長くなっていない');
  assert.ok(feet(0) < feet(1), '初期より第1進化のほうが背が高くない');
  assert.ok(feet(2) > 90, `第2進化の足の裏が高すぎて宙に浮いて見える（${feet(2)}）`);
});

test('未知のキャラIDは例外', () => {
  assert.throws(() => characterSvg('nazono', 0), /nazono/);
});

test('範囲外の形態は例外', () => {
  assert.throws(() => characterSvg('hinoko', 3), /stage/);
});
