import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../js/views/playerSelect.js';
import { createInitialState, createPlayer } from '../js/storage.js';
import { totalExpForLevel } from '../js/core/exp.js';
import { displayStageOf } from '../js/core/player.js';
import { installDom } from './helpers/minidom.js';

// =============================================================================
// 設計の穴: プレイヤーが1人もいない状態から、バックアップを戻す入り口が無い件
// （2026-07-29・安部さんの実測で発覚）。
//
// js/views/settings.js:16 が `if (!player) return app.go('playerSelect');`
// のため、プレイヤー0人だと せってい に入れず、バックアップの「よみこむ」に
// 到達できない。新しい端末・データ消失・公開URL移動のたびに、いったん仮の
// プレイヤーを作ってから せってい へ行く、という説明が必須になっていた。
//
// 直す方針（このテストが固定する仕様）:
//   - 「はじめまして」画面（js/views/playerSelect.js の renderCreate）に
//     「バックアップから もどす」を足す
//   - 出すのは **プレイヤー0人のときだけ**。2人目を足す画面
//     （params.mode === 'create' かつ既にプレイヤーがいる）では出さない。
//     「全部置き換える」ボタンが2人目追加の文脈に並ぶのは危険、という判断
//     （安部さんの実装メモの「私の考えでは0人のときだけ」を採用）
//   - 既存の importJson を使う（js/views/settings.js の読み込み処理と
//     同じ検証・同じ確認を通す）
//   - 0人のときはパスワードゲート不要（承認設定を持つプレイヤーがそもそも
//     存在しない）
//   - 0人のときは「いまの きろくを すべて けして...」の確認ダイアログは
//     **出さない**（消すものが無いため）。これは settings.js の既存の
//     よみこみ（1人以上いる状態からの復元）とは異なる決定
//   - 保存失敗時は「もどしました」と言わず、元の状態に戻す
//     （settings.js の previousState パターンと同じ）
// =============================================================================

const NOW = '2026-07-29T10:00:00.000Z';

/** テスト用の最小 fakeApp。app.js の実際の契約（currentPlayer/persist）を真似る */
function makeFakeApp(initialState, { persistShouldFail = false } = {}) {
  const toasts = [];
  const goCalls = [];
  const fakeApp = {
    state: initialState,
    toasts,
    goCalls,
    today() { return '2026-07-29'; },
    now() { return NOW; },
    newId(prefix) { return `${prefix}-test`; },
    // app.js の currentPlayer() と同じロジック
    currentPlayer() {
      if (!this.state || !this.state.activePlayerId) return null;
      return this.state.players.find((p) => p.id === this.state.activePlayerId) || null;
    },
    // app.js の persist() と同じ契約: 失敗したら「ほぞんできませんでした」を
    // 自分でトーストし、false を返す（成功したふりをしない）
    persist() {
      if (persistShouldFail) {
        toasts.push('ほぞんできませんでした');
        return false;
      }
      return true;
    },
    toast(msg) { toasts.push(msg); },
    go(screen, params) { goCalls.push({ screen, params }); },
    registerScreen(name, fn) {
      this._screens = this._screens || {};
      this._screens[name] = fn;
    },
  };
  return fakeApp;
}

/** playerSelect.js の実 render() を呼び出す */
function renderPlayerSelect(fakeApp, params = {}) {
  register(fakeApp);
  const renderFn = fakeApp._screens.playerSelect;
  const root = document.createElement('div');
  renderFn(root, fakeApp, params);
  return root;
}

/** タグが input で type=file の要素を探す（createElement+プロパティ／innerHTML+属性のどちらでも拾える） */
function findFileInput(root) {
  return root.querySelectorAll('input').find(
    (el) => el.type === 'file' || el.getAttribute('type') === 'file',
  );
}

function makeJsonFile(obj, name = 'backup.json') {
  return new File([JSON.stringify(obj)], name, { type: 'application/json' });
}

/** 正当な version:2 のバックアップ（プレイヤー1人・記録1件） */
function buildValidV2Backup() {
  const s = createInitialState();
  const p = createPlayer({
    id: 'p-backup', name: 'ﾎﾞﾑﾀﾞ', starterId: 'mokumo', now: NOW,
  });
  p.records.push({ id: 'r1', date: '2026-07-01', mode: 'no', count: 10, createdAt: NOW });
  p.chars[0].exp = totalExpForLevel(5);
  s.players.push(p);
  s.activePlayerId = p.id;
  return s;
}

/**
 * v8由来（version:1）を装うバックアップ。test/storage.test.js の
 * benchedHinokoAtStage(1, []) と同じ組み立て（潜在段階=1・evolvedStages=[]）。
 * migrateToV2 を通すと hinoko.evolvedStages が [1] になるはず（M2 と同じ性質）
 */
function buildLegacyV1Backup() {
  const s = createInitialState();
  s.version = 1;
  const p = createPlayer({
    id: 'p-legacy', name: 'ﾏｹﾏｹ', starterId: 'mokumo', now: NOW,
  });
  p.chars.push({
    charId: 'hinoko', nickname: null, exp: totalExpForLevel(20), unlockedAt: NOW, evolvedStages: [],
  });
  for (let d = 1; d <= 5; d += 1) {
    const date = `2026-07-0${d}`;
    p.records.push({ id: `r${d}`, date, mode: 'no', count: 20, createdAt: `${date}T09:00:00.000Z` });
  }
  s.players.push(p);
  s.activePlayerId = p.id;
  return s;
}

// -----------------------------------------------------------------------------
// R1
// -----------------------------------------------------------------------------

test('R1 プレイヤー0人で playerSelect を描画すると、バックアップを戻す入り口（ファイル入力）がある', () => {
  installDom();
  const fakeApp = makeFakeApp(createInitialState());
  const root = renderPlayerSelect(fakeApp);

  const fileInput = findFileInput(root);
  assert.ok(fileInput, '「はじめまして」がめんに type=file の入力が見つからない');
});

// -----------------------------------------------------------------------------
// R2
// -----------------------------------------------------------------------------

test('R2 正しいバックアップJSONを読み込むと、app.stateが丸ごと置き換わり、ファイルの中のプレイヤーだけになる', async () => {
  installDom();
  const fakeApp = makeFakeApp(createInitialState()); // 0人
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  const backup = buildValidV2Backup();
  fileInput.files = [makeJsonFile(backup)];
  await fileInput.fire('change');

  assert.equal(fakeApp.state.players.length, 1, 'ファイルの中のプレイヤーだけになっている');
  assert.equal(fakeApp.state.players[0].id, 'p-backup');
  assert.equal(fakeApp.state.activePlayerId, 'p-backup');

  assert.ok(fakeApp.goCalls.length >= 1, '画面遷移が起きている');
  const last = fakeApp.goCalls[fakeApp.goCalls.length - 1];
  assert.equal(last.screen, 'home', 'よみこんだ後はプレイヤーがいるので home へ進む');
});

// -----------------------------------------------------------------------------
// R3
// -----------------------------------------------------------------------------

test('R3-a 壊れたJSON（パース不能）を読み込んでも、状態は変わらずエラーが伝わる', async () => {
  installDom();
  const initial = createInitialState();
  const fakeApp = makeFakeApp(initial);
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  const before = JSON.stringify(fakeApp.state);
  fileInput.files = [new File(['{ こわれた json'], 'broken.json', { type: 'application/json' })];
  await fileInput.fire('change');

  assert.equal(JSON.stringify(fakeApp.state), before, '状態が変わっていない');
  assert.equal(fakeApp.state.players.length, 0, 'プレイヤーは増えていない');
  assert.equal(fakeApp.goCalls.length, 0, '画面遷移していない');
  assert.ok(globalThis.__alerts.length > 0, 'エラーが伝わっている（alert）');
});

test('R3-b 検証に落ちるJSON（構造は正しいJSONだが状態として不正）を読み込んでも、状態は変わらずエラーが伝わる', async () => {
  installDom();
  const initial = createInitialState();
  const fakeApp = makeFakeApp(initial);
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  const before = JSON.stringify(fakeApp.state);
  // JSON としては正しいが、players が配列でない＝validateState が弾く形
  fileInput.files = [makeJsonFile({ version: 2, players: 'not-an-array', activePlayerId: null })];
  await fileInput.fire('change');

  assert.equal(JSON.stringify(fakeApp.state), before, '状態が変わっていない');
  assert.equal(fakeApp.goCalls.length, 0, '画面遷移していない');
  assert.ok(globalThis.__alerts.length > 0, 'エラーが伝わっている（alert）');
});

// -----------------------------------------------------------------------------
// R4
// -----------------------------------------------------------------------------

test('R4 保存に失敗したら元の状態（0人）にもどり、「もどしました」のような成功は言わない', async () => {
  installDom();
  const initial = createInitialState(); // 0人
  const fakeApp = makeFakeApp(initial, { persistShouldFail: true });
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  const backup = buildValidV2Backup();
  fileInput.files = [makeJsonFile(backup)];
  await fileInput.fire('change');

  assert.equal(fakeApp.state.players.length, 0, '保存に失敗したので元の状態（0人）にもどっている');
  assert.equal(fakeApp.state.activePlayerId, null);
  assert.ok(!fakeApp.toasts.includes('もどしました'), '成功したと言っていない');
  assert.ok(
    fakeApp.goCalls.every((c) => c.screen !== 'home'),
    'home（成功した体）へは進んでいない',
  );
});

// -----------------------------------------------------------------------------
// R5
// -----------------------------------------------------------------------------

test('R5 v8由来（version 1）のバックアップも、この入り口から読める（migrateToV2を通る）', async () => {
  installDom();
  const fakeApp = makeFakeApp(createInitialState());
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  const legacy = buildLegacyV1Backup();
  fileInput.files = [makeJsonFile(legacy, 'legacy.json')];
  await fileInput.fire('change');

  assert.equal(fakeApp.state.version, 2, '読み込み後は version 2 になっている');
  const hinoko = fakeApp.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [1], '潜在段階まで埋まり、絵が退化しない（M2と同じ性質）');
  assert.equal(displayStageOf(fakeApp.state.players[0], 'hinoko'), 1);
});

// -----------------------------------------------------------------------------
// R6
// -----------------------------------------------------------------------------

test('R6 v9以降（version 2）のバックアップを、この入り口から読んでも、控えのキャラは勝手に進化しない', async () => {
  installDom();
  const fakeApp = makeFakeApp(createInitialState());
  const root = renderPlayerSelect(fakeApp);
  const fileInput = findFileInput(root);
  assert.ok(fileInput, '前提: ファイル入力がある');

  // buildLegacyV1Backup と同じ形（潜在段階=1・evolvedStages=[]）だが、
  // version:2 の「正当なv9バックアップ」として扱う（M1と同じ組み立て）
  const backup = buildLegacyV1Backup();
  backup.version = 2;
  fileInput.files = [makeJsonFile(backup, 'v2.json')];
  await fileInput.fire('change');

  assert.equal(fakeApp.state.version, 2);
  const hinoko = fakeApp.state.players[0].chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinoko.evolvedStages, [], '移行は発火しない。控えは進化しない（M1と同じ性質）');
  assert.equal(displayStageOf(fakeApp.state.players[0], 'hinoko'), 0);
});

// -----------------------------------------------------------------------------
// R7
// -----------------------------------------------------------------------------

test('R7 プレイヤーが1人以上いる状態で2人目を足す画面（mode:"create"）では、バックアップを戻す入り口を出さない', () => {
  installDom();
  const state = createInitialState();
  const existing = createPlayer({
    id: 'p-existing', name: 'ﾃｽﾃ', starterId: 'hinoko', now: NOW,
  });
  state.players.push(existing);
  state.activePlayerId = existing.id;
  const fakeApp = makeFakeApp(state);
  const root = renderPlayerSelect(fakeApp, { mode: 'create' });

  const fileInput = findFileInput(root);
  assert.equal(
    fileInput,
    undefined,
    '2人目を足す文脈に「全部置き換える」入り口が並ぶのは危険なので、出してはいけない',
  );
});

test('R7-b 前提: プレイヤーが1人以上いてmode:"create"でも「もどる」ボタンはこれまで通り出る（既存挙動を壊していないことの確認）', () => {
  installDom();
  const state = createInitialState();
  const existing = createPlayer({
    id: 'p-existing', name: 'ﾃｽﾃ', starterId: 'hinoko', now: NOW,
  });
  state.players.push(existing);
  state.activePlayerId = existing.id;
  const fakeApp = makeFakeApp(state);
  const root = renderPlayerSelect(fakeApp, { mode: 'create' });

  const buttons = root.querySelectorAll('button');
  assert.ok(
    buttons.some((b) => b.textContent === 'もどる'),
    '既存の「もどる」ボタンがまだ出ている（今回の変更で消してはいけない）',
  );
});
