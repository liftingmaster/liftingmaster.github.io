import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// 2026-07-30 adversarial-reviewer 指摘（欠陥1・高）: js/views/home.js:64 が
// pendingUnlocks の第3引数（maxEvolvedStageEver）を渡していない。
//
// ぴかり(No.4) の解放条件が「Lv30到達」から「なかまの誰かが だい1しんか
// (stage:1) を実現した」に変わったが（js/core/characters.js・js/core/unlock.js）、
// js/views/home.js だけが第3引数を渡さないまま残っているため、進化を実現しても
// ホームに「あたらしい なかまが まってるよ！」のカードが出ない
// （「なかま」タブを自分で開かない限り、ぴかりの存在に永久に気づけない）。
//
// このテストは js/views/home.js の実際の render() を
// test/helpers/minidom.js 越しに駆動して確認する（実装は書き換えない）。
// 前例: test/partyUnlockView.test.js（同じ日の同じ不具合の party.js 側）
// =============================================================================

const NOW = '2026-07-30T00:00:00.000Z';

/** home.js の実 render() を呼び出す最小 fakeApp */
function makeFakeApp(player) {
  return {
    player,
    _screens: {},
    registerScreen(name, fn) { this._screens[name] = fn; },
    currentPlayer() { return this.player; },
    updatePlayer(fn) { this.player = fn(this.player); return true; },
    today() { return '2026-07-30'; },
    now() { return NOW; },
    go() {},
  };
}

/**
 * ぴかり以外の8体すべてを所持させたプレイヤーを作る。
 *
 * こうしておくと、レベルの節目（Lv10/20/40/50/65/80/100）の解放候補は
 * 「もう持っているので該当なし」になるため、maxLevelEver をどれだけ上げても
 * レベル由来の解放カードが紛れ込まない。これで「進化由来の解放だけ」を
 * 純粋に検証できる（H2 で「レベルがいくら高くても」を確かめるのに必須）。
 */
async function buildPlayer({ evolved }) {
  const { createPlayer } = await import('../js/storage.js');
  const { totalExpForLevel } = await import('../js/core/exp.js');
  const p = createPlayer({
    id: 'p1', name: 'test', starterId: 'hinoko', now: NOW,
  });
  const others = ['shizuku', 'happa', 'mokumo', 'kirara', 'ganro', 'kooru', 'kagero'];
  for (const id of others) {
    p.chars.push({
      charId: id, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [],
    });
  }
  // 「レベルがいくら高くても」を検証するため、育成中キャラを高レベルにしておく
  p.chars[0].exp = totalExpForLevel(50);
  if (evolved) p.chars[0].evolvedStages = [1]; // だい1しんか を実現済み
  return p;
}

test('H1 だい1しんかを実現していれば、ホームに「あたらしい なかまが まってるよ！」相当のカードが出る', async () => {
  const { document } = installDom();
  const { register } = await import('../js/views/home.js');
  const player = await buildPlayer({ evolved: true });
  const fakeApp = makeFakeApp(player);
  register(fakeApp);

  const root = document.createElement('div');
  fakeApp._screens.home(root, fakeApp);

  assert.ok(
    root.textContent.includes('あたらしい なかまが まってるよ'),
    'だい1しんか(evolvedStages=[1])を実現しているのに、ホームに解放カードが出ていない'
    + '（js/views/home.js の pendingUnlocks 呼び出しに maxEvolvedStageEver が渡っていない可能性）',
  );
});

test('H2 だい1しんかを実現していなければ、レベルがいくら高くても解放カードは出ない', async () => {
  const { document } = installDom();
  const { register } = await import('../js/views/home.js');
  const player = await buildPlayer({ evolved: false });
  const fakeApp = makeFakeApp(player);
  register(fakeApp);

  const root = document.createElement('div');
  fakeApp._screens.home(root, fakeApp);

  assert.ok(
    !root.textContent.includes('あたらしい なかまが まってるよ'),
    'だい1しんかを誰も実現していないのに、ホームに解放カードが出てしまっている'
    + '（レベル由来の解放が紛れ込んでいないか確認すること）',
  );
});
