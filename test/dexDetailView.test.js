import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// 2026-07-30 adversarial-reviewer 指摘（欠陥2・中）: js/views/dexDetail.js の
// unlockText() が `unlockLevel === 0`（御三家）と数値（レベル解放）しか
// 想定しておらず、ぴかり(No.4, unlockLevel: null, unlockOnEvolvedStage: 1)を
// 未所持で開くと「Lv null で なかまに なる」という壊れた文言がそのまま
// 子供の画面に出る。再現は「未所持の状態で ずかん → No.004 のセルを押す」
// （js/views/dex.js:37 は未所持でも dexDetail へ飛ぶ）。
//
// このテストファイルでのテスターの決定（仕様）:
//   1. unlockOnEvolvedStage を持つキャラの文言は
//      「なかまの だれかが だい${n}しんか すると なかまに なる」とする。
//      （n は unlockOnEvolvedStage の値。ぴかりは n=1 なので
//       「なかまの だれかが だい1しんか すると なかまに なる」）
//   2. 「いまの さいこう レベル: N」の行は、レベルでは解放されないキャラ
//      （unlockOnEvolvedStage を持つキャラ）には出さない。
//      レベルで解放されるキャラ（御三家・mokumo等）には従来どおり出す。
//
// 実装（js/views/dexDetail.js）は書き換えない。ここに書いた仕様は
// 実装担当がこのテストを緑にするために従うべき仕様として報告する。
// =============================================================================

const NOW = '2026-07-30T00:00:00.000Z';

function makeFakeApp(player) {
  return {
    player,
    _screens: {},
    registerScreen(name, fn) { this._screens[name] = fn; },
    currentPlayer() { return this.player; },
    go() {},
  };
}

async function basePlayer() {
  const { createPlayer } = await import('../js/storage.js');
  // hinoko だけ所持。shizuku・happa・mokumo・pikari は未所持のまま
  return createPlayer({
    id: 'p1', name: 'test', starterId: 'hinoko', now: NOW,
  });
}

async function renderDexDetail(player, charId) {
  const { document } = installDom();
  const { register } = await import('../js/views/dexDetail.js');
  const fakeApp = makeFakeApp(player);
  register(fakeApp);
  const root = document.createElement('div');
  fakeApp._screens.dexDetail(root, fakeApp, { charId });
  return root;
}

test('D1 未所持の ぴかり(No.4) をずかん詳細で開いても「Lv null」が出ない', async () => {
  const player = await basePlayer();
  const root = await renderDexDetail(player, 'pikari');

  assert.ok(
    !root.textContent.includes('Lv null'),
    `「Lv null」が画面に出てしまっている。実際のテキスト: ${root.textContent}`,
  );
});

test('D2 未所持の ぴかり の解放条件は「なかまの だれかが だい1しんか すると なかまに なる」と表示される（テスターが決めた仕様）', async () => {
  const player = await basePlayer();
  const root = await renderDexDetail(player, 'pikari');

  assert.ok(
    root.textContent.includes('なかまの だれかが だい1しんか すると なかまに なる'),
    `決めた仕様どおりの文言が出ていない。実際のテキスト: ${root.textContent}`,
  );

  // unlockOnEvolvedStage を持つキャラにレベルの情報は無関係なので出さない
  assert.ok(
    !root.textContent.includes('いまの さいこう レベル'),
    'レベルでは解放されないぴかりに「いまの さいこう レベル」の表示は不要（テスターの判断）',
  );
});

test('D3-a 未所持の御三家（unlockLevel===0, しずく）は従来どおり「Lv10 か Lv20 で なかまに なる」', async () => {
  const player = await basePlayer();
  const root = await renderDexDetail(player, 'shizuku');

  assert.ok(
    root.textContent.includes('Lv10 か Lv20 で なかまに なる'),
    `御三家の従来表示が壊れている。実際のテキスト: ${root.textContent}`,
  );
  // レベル由来の解放なので、従来どおり「いまの さいこう レベル」を出し続ける
  assert.ok(
    root.textContent.includes('いまの さいこう レベル'),
    '御三家（レベル由来）で「いまの さいこう レベル」の表示が消えてはいけない',
  );
});

test('D3-b 未所持の数値レベル解放キャラ（もくも, unlockLevel:40）は従来どおり「Lv 40 で なかまに なる」', async () => {
  const player = await basePlayer();
  const root = await renderDexDetail(player, 'mokumo');

  assert.ok(
    root.textContent.includes('Lv 40 で なかまに なる'),
    `数値レベル解放の従来表示が壊れている。実際のテキスト: ${root.textContent}`,
  );
  assert.ok(
    root.textContent.includes('いまの さいこう レベル'),
    'もくも（レベル由来）で「いまの さいこう レベル」の表示が消えてはいけない',
  );
});
