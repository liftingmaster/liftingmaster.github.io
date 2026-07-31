import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRecord } from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { levelFromExp } from '../js/core/exp.js';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// 欠陥B（2026-07-29）の回帰網 — 追加ぶん。
//
// test/resultView.test.js の B1・B2 と**同じ現象**を固定するが、期待値は
// 「before は常に保存値」に差し戻したあとの core から取り直している。
// B1・B2 の 23／22 という数字は、差し戻し**前**（日ごとに帳簿を切り替えていた
// 壊れた実装）の実測表から取られており、差し戻し後は 1レベルずつ上にずれる
// 新しいEXP曲線でも回数を調整し、8手目Lv24 → 9手目Lv23を再現する。
// 現象（さかのぼり入力で +0 EXP なのに育成中キャラのレベルが下がる／画面がそれを
// 隠す）は同じなので、テスト側の数字だけを直せば B1・B2 はそのまま通る。
// テストの書き換えは禁止されているため、ここに正しい数字で並走させ、
// B1・B2 の扱いは安部さんの判断を仰ぐ（報告参照）。
//
// 期待値の出どころ（差し戻し後の core を電卓として使わずに追える形で残す）:
//   手順1〜8のexp: 342, 430, 530, 530, 585, 677, 737, 792（Lv24）
//   手順9で7/17の勝者が再反転し、exp=700（Lv23）へ下がる。
// どの手順でも exp == Σ grantedExp（保存則は破れない。A1が別途固定している）。
// =============================================================================

const A1_STEPS = [
  { date: '2026-07-16', mode: 'no', count: 57 },
  { date: '2026-07-20', mode: 'one', count: 44 },
  { date: '2026-07-17', mode: 'one', count: 50 },
  { date: '2026-07-16', mode: 'no', count: 22 },
  { date: '2026-07-18', mode: 'one', count: 55 },
  { date: '2026-07-17', mode: 'no', count: 32 },
  { date: '2026-07-21', mode: 'one', count: 60 },
  { date: '2026-07-18', mode: 'one', count: 11 },
];

const EXPECTED = [342, 430, 530, 530, 585, 677, 737, 792];

function buildSetup() {
  let cur = createPlayer({
    id: 'p1', name: 'たろう', starterId: 'happa', now: '2026-07-01T00:00:00.000Z',
  });
  A1_STEPS.forEach((s, i) => {
    const now = `2026-07-22T${String(9 + i).padStart(2, '0')}:00:00.000Z`;
    cur = addRecord(cur, {
      id: `r${i + 1}`, count: s.count, mode: s.mode, date: s.date, now,
    }).player;
  });
  return cur;
}

test('B1x 9手の再現（差し戻し後）: 各手順で exp が期待値どおりに動き、記録の合計と一致する', () => {
  let cur = createPlayer({
    id: 'p1', name: 'たろう', starterId: 'happa', now: '2026-07-01T00:00:00.000Z',
  });
  A1_STEPS.forEach((s, i) => {
    const now = `2026-07-22T${String(9 + i).padStart(2, '0')}:00:00.000Z`;
    cur = addRecord(cur, {
      id: `r${i + 1}`, count: s.count, mode: s.mode, date: s.date, now,
    }).player;
    const sum = cur.records.reduce((a, r) => a + (r.grantedExp || 0), 0);
    assert.equal(cur.chars[0].exp, EXPECTED[i], `手順${i + 1} の exp`);
    assert.equal(sum, EXPECTED[i], `手順${i + 1} の記録の合計（ズレ0）`);
  });
  assert.equal(levelFromExp(cur.chars[0].exp).level, 24, '8手目終了時点で はっぱ は Lv24');
});

test('B1x core: 9手目（さかのぼり入力・+0 EXP）で育成中キャラ自身が Lv24 → Lv23 に落ち、result がそれを報告する', () => {
  const setup = buildSetup();
  const { player, result } = addRecord(setup, {
    id: 'r9', count: 28, mode: 'one', date: '2026-07-17', now: '2026-07-22T18:00:00.000Z',
  });

  const sum = player.records.reduce((a, r) => a + (r.grantedExp || 0), 0);
  assert.equal(player.chars[0].exp, 700, '9手目の exp');
  assert.equal(sum, 700, '9手目も記録の合計と一致（ズレ0）');
  assert.equal(levelFromExp(player.chars[0].exp).level, 23);

  assert.equal(result.exp, 0, 'この記録自身は +0 EXP');
  assert.equal(result.levelBefore, 24);
  assert.equal(result.levelAfter, 23);
  assert.ok(result.levelBefore > result.levelAfter, 'core は下がったことを報告する');
});

test('B2x recordInput の render()/commit(): +0 EXP でもレベル低下が けっか画面へ渡る（winnerIndex === -1 の穴）', async () => {
  const { document } = installDom();

  let player = buildSetup();
  const goCalls = [];
  const fakeApp = {
    registerScreen(name, fn) {
      this._screens = this._screens || {};
      this._screens[name] = fn;
    },
    currentPlayer() { return player; },
    today() { return '2026-07-22'; },
    now() { return '2026-07-22T18:00:00.000Z'; },
    newId(prefix) { return `${prefix}-b2x`; },
    updatePlayer(fn) { player = fn(player); return true; },
    go(screen, params) { goCalls.push({ screen, params }); },
  };

  const { register } = await import('../js/views/recordInput.js');
  register(fakeApp);
  const root = document.createElement('div');
  fakeApp._screens.recordInput(root, fakeApp);
  const card = root.querySelector('.card');

  const datePick = card.querySelector('#datePick');
  datePick.value = '2026-07-17';
  datePick.fire('change');
  card.querySelector('#modeOne').click();
  const pad = card.querySelector('#pad');
  for (const d of ['2', '8']) pad.children.find((c) => c.textContent === d).click();
  card.querySelector('#save').click();

  assert.equal(levelFromExp(player.chars[0].exp).level, 23, '前提: 実際に Lv24 → Lv23 に落ちている');
  assert.equal(goCalls.length, 1);
  const r = goCalls[0].params.entries[0].result;
  assert.equal(r.exp, 0, '前提: この取引では誰も +EXP を取っていない');
  assert.equal(r.levelBefore, 24, 'けっか画面へ渡る levelBefore');
  assert.equal(r.levelAfter, 23, 'けっか画面へ渡る levelAfter（固定されずに実態を映す）');
});

test('B3x result.js の render(): レベルが下がったら必ず画面に出る（下がった場合の分岐が無かった件）', async () => {
  const { document } = installDom();
  const player = buildSetup();

  const app = {
    registerScreen() {},
    currentPlayer() { return player; },
    today() { return '2026-07-22'; },
    now() { return '2026-07-22T18:00:00.000Z'; },
    go() {},
    state: { lastBackupAt: '2026-07-22T00:00:00.000Z' },
  };
  const { register } = await import('../js/views/result.js');
  const screens = {};
  register({ registerScreen(name, fn) { screens[name] = fn; } });

  const root = document.createElement('div');
  screens.result(root, app, {
    date: '2026-07-17',
    entries: [{
      result: {
        queued: false,
        exp: 0,
        isPersonalBest: false,
        levelBefore: 24,
        levelAfter: 23,
        evolvedTo: null,
        unlocks: [],
        dayWinnerMode: 'one',
        charChanges: [],
      },
      count: 282,
      mode: 'one',
      oldDailyBest: 496,
      charId: 'happa',
      stageBefore: 0,
    }],
  });

  const text = root.textContent;
  assert.ok(
    text.includes('レベルが Lv24 → Lv23 に なったよ'),
    `レベル低下が画面に出ていない: ${text}`,
  );
  assert.ok(
    text.includes('まえに もらっていた EXPは その きろくに うつったよ'),
    `理由の説明が出ていない: ${text}`,
  );
  assert.ok(text.includes('きろくは きえていないから あんしんしてね'));
  assert.ok(!text.includes('レベルアップ'), '下がったのに「レベルアップ！」は出さない');
});

test('B3x result.js の render(): レベルが変わらないときは低下の文言を出さない', async () => {
  const { document } = installDom();
  const player = buildSetup();
  const app = {
    registerScreen() {},
    currentPlayer() { return player; },
    today() { return '2026-07-22'; },
    now() { return '2026-07-22T18:00:00.000Z'; },
    go() {},
    state: { lastBackupAt: '2026-07-22T00:00:00.000Z' },
  };
  const { register } = await import('../js/views/result.js');
  const screens = {};
  register({ registerScreen(name, fn) { screens[name] = fn; } });

  const root = document.createElement('div');
  screens.result(root, app, {
    date: '2026-07-22',
    entries: [{
      result: {
        queued: false,
        exp: 30,
        isPersonalBest: false,
        levelBefore: 24,
        levelAfter: 24,
        evolvedTo: null,
        unlocks: [],
        dayWinnerMode: 'no',
        charChanges: [],
      },
      count: 10,
      mode: 'no',
      oldDailyBest: 0,
      charId: 'happa',
      stageBefore: 0,
    }],
  });
  assert.ok(!root.textContent.includes('に なったよ'));
});
