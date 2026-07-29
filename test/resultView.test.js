import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  benchedLevelDrops, resultSizes, textWidth, CARD_INNER_WIDTH,
} from '../js/views/result.js';
import { addRecord, switchChar } from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { levelFromExp } from '../js/core/exp.js';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// けっか画面が result.charChanges を読んでいなかった件（2026-07-29 欠陥3）の回帰網。
//
// その日のEXPは「いちばん よかった きろく1つぶん」だけなので、別のキャラで付けた
// 記録が負けると、そのキャラに渡していたEXPが取り消される。core は charChanges で
// 全キャラぶん報告していたのに、けっか画面も きろく入力画面も読んでいなかったため、
// 育成中でないキャラの Lv4 → Lv1 が画面のどこにも出なかった。
// =============================================================================

const NOW = '2026-07-26T10:00:00.000Z';

const entry = (charChanges) => ({ result: { charChanges } });

test('D3-a benchedLevelDrops: 育成中でないキャラのレベル低下を拾う', () => {
  const entries = [entry([
    {
      charId: 'hinoko', expDelta: -36, levelBefore: 4, levelAfter: 1, stageBefore: 0, evolvedTo: null,
    },
    {
      charId: 'mokumo', expDelta: 60, levelBefore: 1, levelAfter: 4, stageBefore: 0, evolvedTo: null,
    },
  ])];
  const drops = benchedLevelDrops(entries, ['mokumo']);
  assert.deepEqual(drops, [{
    charId: 'hinoko', levelBefore: 4, levelAfter: 1, expDelta: -36,
  }]);
});

test('D3-b benchedLevelDrops: 育成中のキャラは（レベルが下がっても）出さない。エントリ側で伝えている', () => {
  const entries = [entry([
    {
      charId: 'mokumo', expDelta: -60, levelBefore: 4, levelAfter: 1, stageBefore: 0, evolvedTo: null,
    },
  ])];
  assert.deepEqual(benchedLevelDrops(entries, ['mokumo']), []);
});

test('D3-c benchedLevelDrops: レベルが変わらないEXPの増減は出さない（画面を無駄に長くしない）', () => {
  const entries = [entry([
    {
      charId: 'hinoko', expDelta: -5, levelBefore: 4, levelAfter: 4, stageBefore: 0, evolvedTo: null,
    },
  ])];
  assert.deepEqual(benchedLevelDrops(entries, ['mokumo']), []);
});

test('D3-d benchedLevelDrops: りょうほう（2件）は1つの取引なので、1件目で下がって2件目で戻るなら出さない', () => {
  const entries = [
    entry([{
      charId: 'hinoko', expDelta: -36, levelBefore: 4, levelAfter: 1, stageBefore: 0, evolvedTo: null,
    }]),
    entry([{
      charId: 'hinoko', expDelta: 36, levelBefore: 1, levelAfter: 4, stageBefore: 0, evolvedTo: null,
    }]),
  ];
  assert.deepEqual(benchedLevelDrops(entries, ['mokumo']), []);
});

test('D3-e benchedLevelDrops: りょうほうで下がりきったら、最初のレベルと最後のレベルでまとめて出す', () => {
  const entries = [
    entry([{
      charId: 'hinoko', expDelta: -20, levelBefore: 5, levelAfter: 3, stageBefore: 0, evolvedTo: null,
    }]),
    entry([{
      charId: 'hinoko', expDelta: -16, levelBefore: 3, levelAfter: 1, stageBefore: 0, evolvedTo: null,
    }]),
  ];
  assert.deepEqual(benchedLevelDrops(entries, ['mokumo']), [{
    charId: 'hinoko', levelBefore: 5, levelAfter: 1, expDelta: -36,
  }]);
});

test('D3-f 承認まちのエントリ（charChangesが空）では何も出さない', () => {
  assert.deepEqual(benchedLevelDrops([{ result: { charChanges: [], queued: true } }], ['mokumo']), []);
});

// -----------------------------------------------------------------------------
// 欠陥3の再現手順そのもの。core の実際の出力を通して確かめる
// -----------------------------------------------------------------------------

test('D3-g 再現手順: ひのこで ノー8 → もくもに切り替えて 同じ日に ワン30 で、ひのこ Lv4→Lv1 が拾える', () => {
  const p = createPlayer({
    id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW,
  });
  p.chars.push({
    charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [],
  });

  const first = addRecord(p, {
    id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: '2026-07-20T09:00:00.000Z',
  });
  assert.equal(first.player.chars.find((c) => c.charId === 'hinoko').exp, 36, '前提: ひのこ 36EXP');
  assert.equal(levelFromExp(36).level, 4, '前提: Lv4');

  const switched = switchChar(first.player, 'mokumo').player;
  const second = addRecord(switched, {
    id: 'r2', count: 30, mode: 'one', date: '2026-07-20', now: '2026-07-20T10:00:00.000Z',
  });

  const entries = [{ result: second.result, charId: 'mokumo' }];
  assert.deepEqual(benchedLevelDrops(entries, ['mokumo']), [{
    charId: 'hinoko', levelBefore: 4, levelAfter: 1, expDelta: -36,
  }], 'ひのこが Lv4 → Lv1 に落ちたことを、けっか画面が拾えること');
  assert.equal(second.player.chars.find((c) => c.charId === 'hinoko').exp, 0);
  assert.equal(second.player.chars.find((c) => c.charId === 'mokumo').exp, 60);
});

// -----------------------------------------------------------------------------
// 欠陥4: りょうほう（2件表示）で「つづける」が 375×812 の画面の外（下端933px）に
// 出ていた件。いちばん効くのは「モード ◯◯かい」の行が2行に折り返すこと
// （44px×2行×2ブロック＝約280px）。2件のときだけ縮めて1行に収める
// -----------------------------------------------------------------------------

const LONGEST_MODE_LINE = 'ワンバウンド 1000かい'; // 最長ケース（4桁）

test('D4-a 単一モードの寸法は変えない（549pxで収まっている画面を触らない）', () => {
  assert.deepEqual(resultSizes(1), {
    mode: 44, exp: 26, best: 24, levelUp: 30, rule: 18,
  });
});

test('D4-b 2件表示では全ての文字サイズが単一モードより小さい', () => {
  const one = resultSizes(1);
  const two = resultSizes(2);
  for (const key of Object.keys(one)) {
    assert.ok(two[key] < one[key], `${key} が縮んでいない: ${two[key]} >= ${one[key]}`);
  }
});

test('D4-c 2件表示の「モード ◯◯かい」は、最長の4桁でも枠307pxに1行で収まる', () => {
  const w = textWidth(LONGEST_MODE_LINE, resultSizes(2).mode);
  assert.ok(
    w <= CARD_INNER_WIDTH,
    `${Math.round(w)}px で折り返す。2行になると1ブロックあたり約95px増えて「つづける」が画面外に戻る`,
  );
});

test('D4-d 単一モードの44pxは元々1行に収まっていない（縮める理由の記録）', () => {
  assert.ok(textWidth(LONGEST_MODE_LINE, resultSizes(1).mode) > CARD_INNER_WIDTH);
  assert.ok(textWidth('ノーバウンド 10かい', resultSizes(1).mode) > CARD_INNER_WIDTH);
});

test('D4-e textWidth は全角=1em・半角=0.6em・空白=0.25emで数える', () => {
  assert.equal(textWidth('あいう', 10), 30);
  assert.equal(textWidth('abc', 10), 18);
  assert.equal(textWidth(' ', 10), 2.5);
});

// =============================================================================
// B1・B2: 欠陥B（記録追加でレベルが下がったとき、けっか画面に何も出ない件）の回帰網。
//
// adversarial-reviewer の指摘（2026-07-29・欠陥B）:
//   1. js/views/result.js:179 は `if (r.levelAfter > r.levelBefore)` しかなく、
//      下がった場合の分岐が無い。
//   2. js/views/recordInput.js:337-342 は、その取引の中で誰も +EXP を
//      取らなかった（winnerIndex === -1）とき levelBefore=levelAfter=levelAtStart
//      に固定してしまう。実際には「さかのぼり入力」でその日の勝敗が反転し、
//      育成中のキャラ自身のレベルが下がっていても、この上書きがその事実を隠す。
//
// B1 は core（js/core/player.js の addRecord）の result 自体には正しい値
// （levelBefore > levelAfter）が入っていることを確認する（＝穴は core ではなく
// view 側にある、という切り分け）。実際に current の実装で PASS するはずの
// テストで、「壊れているのは view 側だけ」という前提を固定する。
//
// B2 は実際の js/views/recordInput.js の render()/commit() を（実装を書き換えず）
// 最小限の DOM シム越しに駆動し、app.go('result', { entries, ... }) に渡される
// entries[0].result.levelBefore/levelAfter が実態（24→23）を反映しているかを見る。
// （壊れた実装の実測値から期待値を取ったため。直った実装の正しい値は 24／23）
// 修正後の実装は levelBefore/levelAfter を正しく計算するため、
// このテストは PASS する。
//
// 再現の土台は adversarial-reviewer の「9手の再現」の1〜8手目
// （さかのぼり入力・はっぱ・すくすく Lv20 境界）と同じもの
// （test/expConservation.test.js の A1 と共通）。9手目（ワン282, 7/17）を
// 実際に addRecord / recordInput 経由で適用すると、はっぱは Lv24 → Lv23 に落ちる。
// =============================================================================

const A1_SETUP_STEPS = [
  { date: '2026-07-16', mode: 'no', count: 570 },
  { date: '2026-07-20', mode: 'one', count: 435 },
  { date: '2026-07-17', mode: 'one', count: 496 },
  { date: '2026-07-16', mode: 'no', count: 216 },
  { date: '2026-07-18', mode: 'one', count: 548 },
  { date: '2026-07-17', mode: 'no', count: 316 },
  { date: '2026-07-21', mode: 'one', count: 596 },
  { date: '2026-07-18', mode: 'one', count: 114 },
];

function buildA1SetupPlayer() {
  let cur = createPlayer({
    id: 'p1', name: 'たろう', starterId: 'happa', now: '2026-07-01T00:00:00.000Z',
  });
  A1_SETUP_STEPS.forEach((s, i) => {
    const now = `2026-07-22T${String(9 + i).padStart(2, '0')}:00:00.000Z`;
    cur = addRecord(cur, {
      id: `r${i + 1}`, count: s.count, mode: s.mode, date: s.date, now,
    }).player;
  });
  return cur;
}

test('B1 addRecord（core）の result は、育成中キャラ自身のレベルが下がったとき levelBefore > levelAfter を正しく報告する（穴は core ではなく view 側にある、という切り分け）', () => {
  const setup = buildA1SetupPlayer();
  assert.equal(levelFromExp(setup.chars[0].exp).level, 24, '前提: 8手目終了時点ではっぱはLv24');

  // 9手目: さかのぼって 7/17 にワン282 を追加する（さかのぼり入力）
  const { player, result } = addRecord(setup, {
    id: 'r9', count: 282, mode: 'one', date: '2026-07-17', now: '2026-07-22T18:00:00.000Z',
  });

  assert.equal(levelFromExp(player.chars[0].exp).level, 23, '前提: 実際にはっぱはLv24→Lv23に落ちる');
  assert.equal(result.levelBefore, 24, 'core の result.levelBefore は実際の値を報告する');
  assert.equal(result.levelAfter, 23, 'core の result.levelAfter も実際の値を報告する（+0EXPでも下がったことが分かる）');
  assert.ok(result.levelBefore > result.levelAfter, 'コアの時点では、けっか画面が出せる形になっている');
});

test('B2 再現手順（recordInput.js の実際の render()/commit() を駆動）: さかのぼり入力で育成中キャラ自身のレベルが下がっても、けっか画面へ渡る levelBefore/levelAfter が実態を反映すること', async () => {
  const { document } = installDom();

  let player = buildA1SetupPlayer();
  assert.equal(levelFromExp(player.chars[0].exp).level, 24, '前提: 8手目終了時点ではっぱはLv24');

  const goCalls = [];
  const fakeApp = {
    registerScreen(name, fn) {
      this._screens = this._screens || {};
      this._screens[name] = fn;
    },
    currentPlayer() { return player; },
    today() { return '2026-07-22'; },
    now() { return '2026-07-22T18:00:00.000Z'; }, // 8手目までのどのcreatedAtよりも後
    newId(prefix) { return `${prefix}-b2`; },
    updatePlayer(fn) {
      player = fn(player);
      return true;
    },
    go(screen, params) { goCalls.push({ screen, params }); },
  };

  const { register } = await import('../js/views/recordInput.js');
  register(fakeApp);
  const renderRecordInput = fakeApp._screens.recordInput;

  const root = document.createElement('div');
  renderRecordInput(root, fakeApp);
  const card = root.querySelector('.card');

  // さかのぼり入力: 7/17・ワン・282かい
  const datePick = card.querySelector('#datePick');
  datePick.value = '2026-07-17';
  datePick.fire('change');
  card.querySelector('#modeOne').click();

  const pad = card.querySelector('#pad');
  for (const digit of ['2', '8', '2']) {
    pad.children.find((c) => c.textContent === digit).click();
  }
  assert.equal(card.querySelector('#display').textContent, '282', '前提: 282かいが入力されている');
  assert.equal(card.querySelector('#save').disabled, false, '前提: 保存ボタンが押せる状態');

  card.querySelector('#save').click();

  assert.equal(levelFromExp(player.chars[0].exp).level, 23, '前提: 実際にはLv24→Lv23に落ちている（core は正しく動く。B1参照）');

  assert.equal(goCalls.length, 1, '前提: 1回だけ結果画面へ遷移する');
  const { screen, params } = goCalls[0];
  assert.equal(screen, 'result');
  const entryResult = params.entries[0].result;

  // ここが欠陥B（recordInput.js側）の本体だった。修正前の実装は winnerIndex===-1
  // （この取引では誰も+EXPを取らなかった）を理由に levelBefore=levelAfter=23 に
  // 固定していたが、直った実装は正しく計算するため、
  // （壊れた実装の実測値から期待値を取ったため。直った実装の正しい値は 24／23）
  // このアサーションは PASS する
  assert.equal(entryResult.levelBefore, 24, 'けっか画面へ渡る levelBefore は実態どおり24であるべき');
  assert.equal(entryResult.levelAfter, 23, 'けっか画面へ渡る levelAfter は実態どおり23であるべき（欠陥Bの実装は低下を隠していた）');
});
