import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// 2026-07-30 安部さんの依頼: ぴかり(No.4)の解放条件が「Lv30到達」から
// 「なかまの誰かが だい1しんか(stage:1)を実現した」に変わった。
//
// unlock.js の pendingUnlocks が返す進化由来のエントリは level:null になる
// （設計は test/unlock.test.js の P2/P3/P7 を参照）。js/views/party.js の
// renderUnlock は現状 `<h2>Lv${unlock.level} とうたつ！...` と level を
// そのまま文字列に埋め込んでいるだけなので、level:null のエントリを渡すと
// 「Lvnull とうたつ！」という壊れた文言が出てしまう。
//
// このテストは js/views/party.js の実際の render()（内部で renderUnlock を
// 呼ぶ）を test/helpers/minidom.js 越しに駆動して確認する（実装は書き換えない）。
//
// 注意: party.js は `import { renderNav } from '../app.js'` を持ち、app.js は
// モジュール読み込み時に boot() を（awaitせず）起動する。boot() は
// localStorage/document が最小DOMシムにそろっていれば例外を投げずバックグラウンドで
// 終わる（実測確認済み）ので、このファイルでは無視してよい。
// =============================================================================

/** party.js の実 render() を呼び出す最小 fakeApp */
function makeFakeApp(player) {
  return {
    player,
    _screens: {},
    registerScreen(name, fn) { this._screens[name] = fn; },
    currentPlayer() { return this.player; },
    updatePlayer(fn) { this.player = fn(this.player); return true; },
    now() { return '2026-07-30T00:00:00.000Z'; },
    toast() {},
    go() {},
  };
}

test('P9 renderUnlock は進化由来（level:null）の解放エントリを渡されても「Lvnull」のような文字列を出さない', async () => {
  const { document } = installDom();
  const { createPlayer } = await import('../js/storage.js');
  const { register } = await import('../js/views/party.js');

  // 御三家3体を先に持たせ、Lv10・Lv20のレベル由来の解放待ちを起こさない
  // （進化由来の解放カードだけが出る状況を作る）。ひのこはすでに
  // だい1しんか(stage 1)を実現済み(evolvedStages=[1])にする。
  const NOW = '2026-07-30T00:00:00.000Z';
  const p = createPlayer({
    id: 'p1', name: 'test', starterId: 'hinoko', now: NOW,
  });
  p.chars.push({
    charId: 'shizuku', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [],
  });
  p.chars.push({
    charId: 'happa', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [],
  });
  p.chars[0].evolvedStages = [1];

  const fakeApp = makeFakeApp(p);
  register(fakeApp);

  const root = document.createElement('div');
  fakeApp._screens.party(root, fakeApp);

  // 前提: 進化由来の解放カード自体は出ていること
  // （party.js 自身の pendingUnlocks 呼び出しにも新しい引数が渡っている前提。
  //   ここが false のまま「Lvnullを含まない」だけ確認すると、実は何も
  //   描画されていないだけで通ってしまう空振りテストになるため、必ず確認する）
  assert.ok(
    root.textContent.includes('ぴかり'),
    '前提: だい1しんかを実現済みなのに、ぴかりの解放カードが描画されていない'
    + '（party.js 自身の pendingUnlocks 呼び出しが maxEvolvedStageEver を渡していない可能性）',
  );

  assert.ok(
    !root.textContent.includes('Lvnull'),
    '進化由来のエントリ(level:null)を渡したときに「Lvnull とうたつ！」のような文字列が出てはいけない',
  );
});
