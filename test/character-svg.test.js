import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../js/core/characters.js';
import { characterSvg, svgFallback } from '../js/svg/character.js';
import { hasArt, artPath } from '../js/svg/artManifest.js';
import { svgExtents } from './helpers/svg-extents.js';

const IMAGE_CHAR_IDS = ['shizuku', 'happa', 'pikari', 'mokumo'];
const IMAGE_CHARACTERS = [
  { id: 'shizuku', name: 'しずく' },
  { id: 'happa', name: 'はっぱ' },
  { id: 'pikari', name: 'ぴかり' },
  { id: 'mokumo', name: 'もくも' },
];
const SVG_REPRESENTATIVE = 'kirara';

// Task 28: ひのこは画像（<img>）で描かれるようになったため、SVG生成コードそのものを
// 見るテスト（この1件と、下の「形態が進むほど大きくなる」）は代表キャラを
// shizuku（画像を持たない）に差し替えた。
//
// 本タスク（しずく・はっぱの画像差し替え）で shizuku 自身が画像を持つように
// なったため、代表キャラをさらに pikari（当時は画像を持たない）に
// 差し替える。テストの狙い（SVG文字列が正しく組み立つこと）は変わっていない。
// ぴかり・もくもも画像化されたため、現在は kirara を代表キャラにする。
// ART に新しいキャラが増えるたびにここを差し替えるのは本質的ではないが、
// 「画像を持たないキャラで代表させる」という設計そのものが ART の変化に弱い
// ことは変えられない。せめて hasArt() で自動検知して分かりやすく落とす。

test('SVG文字列を返す', () => {
  assert.ok(!hasArt(SVG_REPRESENTATIVE, 0), `${SVG_REPRESENTATIVE} が画像化された場合、この代表キャラを別のIDに差し替える必要がある`);
  const svg = characterSvg(SVG_REPRESENTATIVE, 0);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 100 100"'));
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('9体 × 3形態すべてが描画できる', () => {
  for (const c of CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = characterSvg(c.id, stage);
      // <img> はコード組み立てのSVGより文字数が短くて正常なため、しきい値を描画方式で分ける。
      // 狙いは変わらない：空や壊れた出力（極端に短い文字列）でないことの確認。
      const minLength = hasArt(c.id, stage) ? 40 : 100;
      assert.ok(svg.length > minLength, `${c.id} stage${stage} が短すぎる`);
      // 画像を持つキャラ（Task 28時点ではひのこ）は <img>、それ以外は <svg> を返す。
      assert.ok(svg.startsWith('<svg') || svg.startsWith('<img'), `${c.id} stage${stage}`);
    }
  }
});

test('キャラ固有の色が使われる', () => {
  for (const c of CHARACTERS) {
    // 画像で描くキャラは色がPNGに焼き込み済みで、マークアップ（<img>）には出ない。
    // この保証はSVG描画コード（PARTS）が自分の色を使っているかのチェックなので対象外にする。
    if (hasArt(c.id, 0)) continue;
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
      // 画像（<img>）はSVGのviewBoxを持たず、この不変条件の対象外
      // （そもそも svgExtents が拾う <circle|ellipse|rect|path> が存在しない）。
      if (hasArt(c.id, stage)) continue;
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
      // 画像（<img>）は図形を持たないためループの中身が実行されず素通りするだけ。
      // 意図的な素通り（見落としではない）だと分かるように明示しておく。
      if (hasArt(c.id, stage)) continue;
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
  // 元は hinoko で見ていたが、Task 28 で hinoko は画像（<img>）になり SVG座標を
  // 持たなくなったため、共通の BODY/skeleton をまだ使っている shizuku に差し替えた。
  // shizuku、pikari、mokumo も画像化されたため、kirara に差し替える
  // （この不変条件は体格表 BODY 自体の話で、特定キャラの話ではない）。
  const bodyWidth = (stage) => {
    const ellipses = svgExtents(characterSvg(SVG_REPRESENTATIVE, stage)).filter((s) => s.kind === 'ellipse');
    return Math.max(...ellipses.map((s) => s.maxX - s.minX));
  };
  const feet = (stage) => Math.max(
    ...svgExtents(characterSvg(SVG_REPRESENTATIVE, stage)).filter((s) => s.kind === 'rect').map((s) => s.maxY)
  );
  const legLength = (stage) => Math.max(
    ...svgExtents(characterSvg(SVG_REPRESENTATIVE, stage)).filter((s) => s.kind === 'rect').map((s) => s.maxY - s.minY)
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

// --- Task 28: 画像を持つキャラ（ひのこ）の描画 ---

test('画像を持つキャラ（ひのこ）は3形態とも <img> を返し、srcが対応するPNGを指す', () => {
  for (const stage of [0, 1, 2]) {
    const html = characterSvg('hinoko', stage);
    assert.ok(html.startsWith('<img'), `stage${stage}: <img> ではない`);
    assert.ok(html.includes(`src="./js/img/hinoko-${stage}.png"`), `stage${stage}: srcが期待どおりでない`);
  }
});

test('画像を持たないキャラ（kirara）は今までどおり <svg> を返す', () => {
  for (const stage of [0, 1, 2]) {
    const html = characterSvg(SVG_REPRESENTATIVE, stage);
    assert.ok(html.startsWith('<svg'), `stage${stage}: <svg> ではない`);
  }
});

// --- 本タスク（御三家の残り2体、しずく・はっぱの画像差し替え）---
//
// ART にキーを足すだけで自動的に対象へ入る、というのが js/svg/artManifest.js の
// 設計（コメント参照）。ここではその約束が実際に守られているかを、
// ひのこ用に書いた検査と同じ形でしずく・はっぱにもかける（A8）。

test('画像を持つキャラ（しずく・はっぱ・ぴかり・もくも）は3形態とも <img> を返し、srcが対応するPNGを指す', () => {
  for (const charId of IMAGE_CHAR_IDS) {
    for (const stage of [0, 1, 2]) {
      const html = characterSvg(charId, stage);
      assert.ok(html.startsWith('<img'), `${charId} stage${stage}: <img> ではない`);
      assert.ok(html.includes(`src="./js/img/${charId}-${stage}.png"`), `${charId} stage${stage}: srcが期待どおりでない`);
    }
  }
});

test('しずく・はっぱ・ぴかり・もくもの <img> は silhouette のとき本名を出さず、灰色シルエット用クラスが付く', () => {
  for (const c of IMAGE_CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const html = characterSvg(c.id, stage, { silhouette: true });
      assert.ok(!html.includes(c.name), `${c.id} stage${stage}: silhouette なのに本名が出た`);
      assert.ok(html.includes('class="char-silhouette"'), `${c.id} stage${stage}: シルエット用クラスが付いていない`);
      assert.ok(html.includes('draggable="false"'), `${c.id} stage${stage}: 長押し・ドラッグ対策が付いていない`);
      assert.ok(html.includes('alt="みかいほうの キャラクター"'), `${c.id} stage${stage}: altが未解放向けでない`);
    }
  }
});

test('しずく・はっぱ・ぴかり・もくもも hasArt が true・artPath が正しいパスを返す', () => {
  for (const charId of IMAGE_CHAR_IDS) {
    for (const stage of [0, 1, 2]) {
      assert.equal(hasArt(charId, stage), true, `${charId} stage${stage}`);
      assert.equal(artPath(charId, stage), `./js/img/${charId}-${stage}.png`);
    }
  }
});

test('しずく・はっぱ・ぴかり・もくもの svgFallback は hasArt を無視して必ずSVGを返す（画像読み込み失敗時の描き直し用）', () => {
  for (const c of IMAGE_CHARACTERS) {
    for (const stage of [0, 1, 2]) {
      const svg = svgFallback(c.id, stage);
      assert.ok(svg.startsWith('<svg'), `${c.id} stage${stage}: <svg> ではない`);
      assert.ok(svg.includes(`aria-label="${c.name}"`), `${c.id} stage${stage}: 通常表示なのに本名が出ていない`);
    }
  }
});

test('ひのこの <img> は silhouette のとき本名を出さず、灰色シルエット用クラスが付く', () => {
  for (const stage of [0, 1, 2]) {
    const html = characterSvg('hinoko', stage, { silhouette: true });
    assert.ok(!html.includes('ひのこ'), `stage${stage}: silhouette なのに本名が出た`);
    assert.ok(html.includes('class="char-silhouette"'), `stage${stage}: シルエット用クラスが付いていない`);
    assert.ok(html.includes('draggable="false"'), `stage${stage}: 長押し・ドラッグ対策が付いていない`);
    assert.ok(html.includes('alt="みかいほうの キャラクター"'), `stage${stage}: altが未解放向けでない`);
  }
});

test('ひのこの <img> はsizeがwidth/heightに反映される（読み込み前のレイアウト崩れ防止）', () => {
  const html = characterSvg('hinoko', 0, { size: 240 });
  assert.ok(html.includes('width="240"'));
  assert.ok(html.includes('height="240"'));
});

test('artPath はキャラIDと形態からPNGパスを組み立てる', () => {
  assert.equal(artPath('hinoko', 1), './js/img/hinoko-1.png');
  assert.equal(hasArt('hinoko', 2), true);
  assert.equal(hasArt('pikari', 0), true);
  assert.equal(artPath('pikari', 2), './js/img/pikari-2.png');
  assert.equal(hasArt('mokumo', 0), true);
  assert.equal(artPath('mokumo', 2), './js/img/mokumo-2.png');
  assert.equal(hasArt('hinoko', 3), false); // 範囲外の形態は持っていない扱い
});

// --- 画像読み込み失敗時のフォールバック（js/imgFallback.js）が使うデータ ---

test('ひのこの <img> は、フォールバックが状態なしで描き直せるだけの data-* を持つ', () => {
  const html = characterSvg('hinoko', 1, { size: 120, silhouette: true });
  assert.ok(html.includes('data-char-id="hinoko"'), 'data-char-id が無い');
  assert.ok(html.includes('data-stage="1"'), 'data-stage が無い');
  assert.ok(html.includes('data-size="120"'), 'data-size が無い');
  assert.ok(html.includes('data-silhouette="true"'), 'data-silhouette が無い');
});

test('画像を持たないキャラの <svg> には data-char-id 等は付かない（<img> 専用の仕組みのため）', () => {
  const html = characterSvg(SVG_REPRESENTATIVE, 0);
  assert.ok(!html.includes('data-char-id'), 'SVGにも data-char-id が付いてしまっている');
});

test('svgFallback は hasArt を無視して必ずSVGを返す（画像読み込み失敗時の描き直し用）', () => {
  for (const stage of [0, 1, 2]) {
    const svg = svgFallback('hinoko', stage);
    assert.ok(svg.startsWith('<svg'), `stage${stage}: <svg> ではない`);
    assert.ok(svg.includes('aria-label="ひのこ"'), `stage${stage}: 通常表示なのに本名が出ていない`);
  }
});

test('svgFallback も silhouette のときは本名を出さない', () => {
  const svg = svgFallback('hinoko', 0, { silhouette: true });
  assert.ok(!svg.includes('ひのこ'));
  assert.ok(svg.includes('aria-label="みかいほうの キャラクター"'));
});

test('svgFallback は画像を持たないキャラ・不正な入力でも characterSvg と同じ例外を出す', () => {
  assert.throws(() => svgFallback('nazono', 0), /nazono/);
  assert.throws(() => svgFallback('hinoko', 3), /stage/);
  // 画像を持たないキャラでも普通に使える（将来 imgFallback 経由で来ることは無いが、
  // hasArt を無視するという仕様どおりであることの確認）
  assert.ok(svgFallback(SVG_REPRESENTATIVE, 0).startsWith('<svg'));
});
