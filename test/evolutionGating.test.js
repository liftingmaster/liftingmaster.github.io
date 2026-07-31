import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecord, editRecord, switchChar, stageOf, displayStageOf,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { totalExpForLevel, levelFromExp } from '../js/core/exp.js';

// =============================================================================
// 進化の意味論そのものを変える改訂（2026-07-28・安部さんの判断）への回帰網。
//
// 背景: 進化条件は「レベル（そのキャラ固有）AND 自己ベスト回数（プレイヤー共通）
// AND 連続日数（プレイヤー共通）」の3つのAND。EXPは育成中のキャラ1体にしか
// 入らないが、自己ベストと連続日数はプレイヤー共通なので、以前育てていて
// レベルだけは足りている控えのキャラが、EXPを1ももらわずに条件を満たしてしまう
// （安部さんの実測: commitRecordとapplyRecordChangeで挙動が違い、控えでも
// displayStageOfが黙って進化後の絵を返していた）。
//
// 新しい意味論:
//   - 潜在段階 = stageOf(player, charId)（条件を満たしているか。判定用。意味は
//     変えない。ホームの「しんかの じょうけん」・ずかん詳細のチェックリストは
//     これを使う）
//   - 実現段階 = displayStageOf(player, charId)（実際にその姿になっている段階。
//     新定義は Math.max(0, ...entry.evolvedStages)。characterSvg に渡すのはこちら）
//   - evolvedStages への追記は「育成中のキャラ（activeCharId）」に対してのみ:
//       commitRecord（普段の記録）      : 従来どおり
//       applyRecordChange（なおす／けす）: 育成中のキャラだけに絞る（兄弟のEXP
//                                          増減はcharChangesに残す。evolvedToはnull）
//       switchChar（育成キャラの切り替え）: 新しく検知する。切り替え先の
//                                          潜在段階が実現段階を上回れば追記する
//
// 「なおす／けす」側の書き換え（I8・I9の反転）は test/recordEditSymmetric.test.js。
// このファイルは commitRecord ↔ switchChar の境界と、G7〜G9（移行・ヒント）を除く
// 一連のシナリオを1本のストーリーとして固定する。
// =============================================================================

const NOW = '2026-07-26T10:00:00.000Z';

const buildBenchScenario = () => {
  // ひのこ 第1進化: レベル15 / ノー15 or ワン50 / 連続5にち
  // しずく 第1進化: レベル12 / ノー10 or ワン35 / 連続10にち
  // 両方 exp=9958（levelFromExp(9958).level === 26）でレベル条件は両者とも
  // 最初から満たしている。ブロッカーは「自己ベスト・連続日数（プレイヤー共通）」
  // だけにして、育成中(ひのこ)が記録した瞬間に両方の潜在段階が動くようにする
  let p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars[0].exp = 9958;
  p.chars.push({ charId: 'shizuku', nickname: null, exp: 9958, unlockedAt: NOW, evolvedStages: [] });

  // ノー9かいを10-02〜10-09まで連続で記録（自己ベストはまだ9のまま）
  let cur = p;
  for (let d = 2; d <= 9; d += 1) {
    const date = `2026-07-0${d}`;
    cur = addRecord(cur, { id: `f${d}`, count: 9, mode: 'no', date, now: `${date}T09:00:00.000Z` }).player;
  }
  return cur;
};

test('G1 普段の記録で自己ベストが伸びて控えの潜在段階が上がっても、実現段階は上がらず evolvedStages は空のまま', () => {
  let cur = buildBenchScenario();
  // 10-01の記録が無いので、まずは10-01にも9かいを入れて10日連続にしてから、
  // 10-10にノー9→20を記録する（連続10日・自己ベスト9→20）
  cur = addRecord(cur, { id: 'f1', count: 9, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  const { player, result } = addRecord(cur, {
    id: 'r10', count: 20, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  });

  // 前提: ひのこ(育成中)は普段どおり本当に進化する
  assert.equal(result.evolvedTo, 1, '前提: 育成中のひのこは記録した瞬間に進化する');
  assert.deepEqual(player.chars.find((c) => c.charId === 'hinoko').evolvedStages, [1]);

  const shizuku = player.chars.find((c) => c.charId === 'shizuku');
  assert.equal(shizuku.exp, 9958, 'しずくはEXPを1ももらっていない');
  assert.equal(stageOf(player, 'shizuku'), 1, '潜在段階（判定用）はしずくも満たしている。ここは意味を変えない');
  assert.deepEqual(shizuku.evolvedStages, [], '実現はしていない。evolvedStagesに追記されてはいけない');
  assert.equal(displayStageOf(player, 'shizuku'), 0, '絵は進化前のまま（安部さんが指摘した症状の直接の回帰網）');
});

test('G2 G1のあと switchChar(shizuku) すると、そこで初めて evolvedTo が返り evolvedStages に積まれる', () => {
  let cur = buildBenchScenario();
  cur = addRecord(cur, { id: 'f1', count: 9, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  cur = addRecord(cur, {
    id: 'r10', count: 20, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  }).player;
  assert.equal(displayStageOf(cur, 'shizuku'), 0, '前提: まだ実現していない');

  const { player, result } = switchChar(cur, 'shizuku');
  assert.equal(result.charId, 'shizuku');
  assert.equal(result.stageBefore, 0, '切り替え前の実現段階');
  assert.equal(result.evolvedTo, 1, '切り替えた瞬間に進化が検知される');
  assert.deepEqual(player.chars.find((c) => c.charId === 'shizuku').evolvedStages, [1]);
  assert.equal(displayStageOf(player, 'shizuku'), 1, '絵も進化後になる');
  // ひのこのEXP・evolvedStagesは切り替えの影響を受けない
  assert.deepEqual(player.chars.find((c) => c.charId === 'hinoko').evolvedStages, [1]);
});

test('G3 G2のあとさらに行き来しても、同じ段階が二度演出されない', () => {
  let cur = buildBenchScenario();
  cur = addRecord(cur, { id: 'f1', count: 9, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  cur = addRecord(cur, {
    id: 'r10', count: 20, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  }).player;
  cur = switchChar(cur, 'shizuku').player; // ここで実現(evolvedStages=[1])

  const toHinoko = switchChar(cur, 'hinoko');
  assert.equal(toHinoko.result.evolvedTo, null, 'ひのこはすでに実現済み(潜在1=実現1)なので進化しない');

  const backToShizuku = switchChar(toHinoko.player, 'shizuku');
  assert.equal(backToShizuku.result.evolvedTo, null, 'しずくもすでに実現済みなので、戻ってきても再演出されない');
  assert.deepEqual(
    backToShizuku.player.chars.find((c) => c.charId === 'shizuku').evolvedStages,
    [1],
    '重複して追記されない',
  );
});

test('G4 育成中のキャラは従来どおり、記録した瞬間に進化する（回帰）', () => {
  let cur = buildBenchScenario();
  cur = addRecord(cur, { id: 'f1', count: 9, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  const { player, result } = addRecord(cur, {
    id: 'r10', count: 20, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  });
  assert.equal(result.evolvedTo, 1);
  assert.equal(displayStageOf(player, 'hinoko'), 1, '育成中のキャラは記録した瞬間に絵も進化する');
});

test('G5 なおす／けすで兄弟キャラのEXPが動いて潜在段階が上がっても、evolvedToはnull。charChangesの他の値は従来どおり報告される', () => {
  let p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars.push({ charId: 'mokumo', nickname: null, exp: totalExpForLevel(15) - 10, unlockedAt: NOW, evolvedStages: [] });
  for (let d = 6; d <= 9; d += 1) {
    p.records.push({
      id: `filler${d}`, date: `2026-07-0${d}`, mode: 'one', count: 1, createdAt: `2026-07-0${d}T09:00:00.000Z`,
    });
  }
  let cur = addRecord(p, { id: 'r1', count: 100, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z' }).player;
  cur = switchChar(cur, 'mokumo').player;
  cur = addRecord(cur, { id: 'r2', count: 30, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:01:00.000Z' }).player;
  cur = switchChar(cur, 'hinoko').player; // もくもを育成中でない状態に戻す

  const { player, result } = editRecord(cur, { recordId: 'r1', count: 5, now: '2026-07-10T09:02:00.000Z' });
  const mokumoChange = result.charChanges.find((c) => c.charId === 'mokumo');
  assert.ok(mokumoChange);
  assert.equal(mokumoChange.expDelta, 50, 'EXP増減はcharChangesに載る');
  assert.equal(mokumoChange.levelBefore, 14, 'レベル低下・上昇の確認に必要なので維持');
  assert.equal(mokumoChange.levelAfter, 16);
  assert.equal(mokumoChange.evolvedTo, null, '育成中でないもくもは進化しない');
  assert.deepEqual(player.chars.find((c) => c.charId === 'mokumo').evolvedStages, []);
});

test('G6 なおす／けすで育成中のキャラが進化するケースは従来どおり演出が出る（回帰）', () => {
  let p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars.push({ charId: 'mokumo', nickname: null, exp: totalExpForLevel(15) - 10, unlockedAt: NOW, evolvedStages: [] });
  for (let d = 6; d <= 9; d += 1) {
    p.records.push({
      id: `filler${d}`, date: `2026-07-0${d}`, mode: 'one', count: 1, createdAt: `2026-07-0${d}T09:00:00.000Z`,
    });
  }
  let cur = addRecord(p, { id: 'r1', count: 100, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z' }).player;
  cur = switchChar(cur, 'mokumo').player;
  cur = addRecord(cur, { id: 'r2', count: 30, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:01:00.000Z' }).player;
  // もくもを育成中のままにして編集する（G5との対比）
  assert.equal(cur.activeCharId, 'mokumo');

  const { player, result } = editRecord(cur, { recordId: 'r1', count: 5, now: '2026-07-10T09:02:00.000Z' });
  const mokumoChange = result.charChanges.find((c) => c.charId === 'mokumo');
  assert.equal(mokumoChange.evolvedTo, 1, '育成中なら進化が検知される');
  assert.deepEqual(player.chars.find((c) => c.charId === 'mokumo').evolvedStages, [1]);
  assert.equal(displayStageOf(player, 'mokumo'), 1);
});

// G9: ずかん・パーティのヒント（「そだてると しんかしそう！」相当）の判定は、
// core が新しい専用関数を増やさなくても、既存の2値の比較だけで表現できることを固定する
test('G9 控えのキャラで潜在段階 > 実現段階のとき、それを stageOf と displayStageOf の比較で判定できる（ずかん・パーティのヒント用）', () => {
  let cur = buildBenchScenario();
  cur = addRecord(cur, { id: 'f1', count: 9, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  const { player } = addRecord(cur, {
    id: 'r10', count: 20, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  });

  const hasHint = (pl, charId) => stageOf(pl, charId) > displayStageOf(pl, charId);
  assert.equal(hasHint(player, 'shizuku'), true, '控えのしずくは「そだてると しんかしそう」の対象');
  assert.equal(hasHint(player, 'hinoko'), false, '育成中のひのこはすでに実現しているので対象外');

  const { player: afterSwitch } = switchChar(player, 'shizuku');
  assert.equal(hasHint(afterSwitch, 'shizuku'), false, '実現したのでヒントは消える');
});

// =============================================================================
// M8・M9（安部さんの指示・2026-07-28、adversarial-reviewerの5回目のレビュー指摘）:
// switchChar は「潜在段階が0→2に一気に上がった」ようなケースで
// `for (let s = stageBefore + 1; s <= potential; s += 1)` によって [1,2] を積むが、
// commitRecord（addRecordの内部処理）と applyRecordChange（editRecord/deleteRecordの
// 内部処理）は `evolvedStages.push(stageAfter)` しかしておらず、0→2の一気進化では
// [2] しか積まない（[1]が抜ける）。これは v8 からある既存の非対称で、今回の
// evolutionGate→version移行と合わせて塞ぐ対象になった。
// 3つとも stageBefore+1..stageAfter を積むことを、ここで固定する。
// =============================================================================

/**
 * ひのこが 0→2 に一気に進化する状況を作る。
 * 第1進化: level15 / ノー15 or ワン50 / streak5。第2進化: level45 / ノー40 / streak14。
 * レベルとstreakは先に満たしておき、bestNoだけを「一撃で1→40」に動かすことで、
 * 記録前は両段階とも不成立（bestNoが低いため）、記録後は両段階とも成立という
 * 0→2の同時ジャンプを起こす。
 */
function buildZeroToTwoJumpSetup() {
  const NOW2 = '2026-07-26T10:00:00.000Z';
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW2 });
  p.chars[0].exp = totalExpForLevel(45); // レベルは両段階とも既に満たす
  // 07-01〜07-13は count=1 の記録（bestNo=1のまま）。07-14を「対象記録」にする。
  // 07-01〜07-14の14日連続で streak=14（両段階のstreak条件も既に満たす）
  for (let d = 1; d <= 13; d += 1) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    p.records.push({ id: `f${d}`, date, mode: 'no', count: 1, createdAt: `${date}T09:00:00.000Z` });
  }
  return p;
}

test('M8 commitRecord: 0→2の一気進化でevolvedStagesに[1,2]を積む（switchCharと揃える）', () => {
  const p = buildZeroToTwoJumpSetup();
  assert.equal(stageOf(p, 'hinoko'), 0, '前提: 記録前はbestNoが低く、まだどちらの段階も満たさない');

  const { player, result } = addRecord(p, {
    id: 'r14', count: 40, mode: 'no', date: '2026-07-14', now: '2026-07-14T09:00:00.000Z',
  });

  assert.equal(stageOf(player, 'hinoko'), 2, '前提: 記録後は一気に潜在段階2まで満たす');
  assert.equal(result.evolvedTo, 2);
  assert.deepEqual(
    player.chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1, 2],
    '0→2の一気進化なら、switchCharと同じく途中の段階(1)も積む。[2]だけでは第1進化の演出が二度と出ない',
  );
});

test('M9 applyRecordChange(editRecord): 0→2の一気進化でevolvedStagesに[1,2]を積む（switchCharと揃える）', () => {
  const p = buildZeroToTwoJumpSetup();
  // 対象記録R自身: 07-14にcount=1で記録しておき、あとでeditRecordで40へ直す
  p.records.push({
    id: 'target', date: '2026-07-14', mode: 'no', count: 1, createdAt: '2026-07-14T09:00:00.000Z',
  });
  assert.equal(stageOf(p, 'hinoko'), 0, '前提: 編集前はbestNoが低く、まだどちらの段階も満たさない');

  const { player, result } = editRecord(p, {
    recordId: 'target', count: 40, now: '2026-07-14T09:01:00.000Z',
  });

  assert.equal(stageOf(player, 'hinoko'), 2, '前提: 編集後は一気に潜在段階2まで満たす');
  assert.equal(result.evolvedTo, 2, '育成中(hinoko)自身の記録を直したので進化が検知される');
  assert.deepEqual(
    player.chars.find((c) => c.charId === 'hinoko').evolvedStages,
    [1, 2],
    '0→2の一気進化なら、switchCharと同じく途中の段階(1)も積む。[2]だけでは第1進化の演出が二度と出ない',
  );
});
