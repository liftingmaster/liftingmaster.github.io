import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecord, approvePending, editRecord, deleteRecord,
  activeCharEntry, stageOf, displayStageOf, switchChar,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { totalExpForLevel, levelFromExp } from '../js/core/exp.js';
import { personalBest } from '../js/core/stats.js';

// 仕様: docs/superpowers/specs/2026-07-27-record-edit-and-dual-mode.md
// §2.2.2（新データの差額調整）／§2.2.2'（旧データの推定方式）／§2.2.3（進化演出のトリガー）
//
// 2026-07-28（2回目）: adversarial-reviewer が「テストが緑のまま壊れている箇所」を
// 5件検出（時間文脈リーク／クランプ非対称／引く基準と足す基準の不一致／
// 兄弟キャラの報告漏れ／deleteRecordのevolvedTo握殺）。実装は「対称なbefore/after
// リプレイ方式」に組み替える予定（player.js 未着手）。新方式の不変条件・新規テストは
// test/recordEditSymmetric.test.js に集約した。このファイルでは、新方式で
// 期待値そのものが変わる既存テスト5件だけを、各テストの直前コメントで
// 「なぜ古い期待値が無効になったか」を明示して書き換えている
// （検索目印: 「対称リプレイ方式」）。

const NOW = '2026-07-26T10:00:00.000Z';

/** player.test.js の base() と同じ組み立て方 */
const base = (starterId = 'mokumo') => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

// ---------------------------------------------------------------------------
// 受け入れ条件1: 新規記録は charId・grantedExp を持つ
// ---------------------------------------------------------------------------

test('addRecord（承認OFF）で確定した記録は charId・grantedExp を持つ', () => {
  const p = base('mokumo');
  const { player, result } = addRecord(p, { id: 'r1', count: 10, mode: 'one', date: '2026-07-26', now: NOW });
  const rec = player.records.find((r) => r.id === 'r1');
  assert.equal(rec.charId, 'mokumo');
  assert.equal(rec.grantedExp, result.exp);
  assert.equal(rec.grantedExp, 20); // 10 × 1 × 2（もくものふわふわ）
});

test('approvePending で確定した記録も charId・grantedExp を持つ', () => {
  const p = base('mokumo');
  p.settings.approvalEnabled = true;
  const queued = addRecord(p, { id: 'q1', count: 10, mode: 'one', date: '2026-07-26', now: NOW }).player;
  const { player, result } = approvePending(queued, { pendingId: 'q1', count: 10, now: NOW });
  const rec = player.records.find((r) => r.id === 'q1');
  assert.equal(rec.charId, 'mokumo');
  assert.equal(rec.grantedExp, result.exp);
  assert.equal(rec.grantedExp, 20);
});

// ---------------------------------------------------------------------------
// 受け入れ条件2: 新データの差額調整（単発ケース）
// ---------------------------------------------------------------------------

test('editRecord: 新データの単発ケースで回数を減らすと差額調整どおりになる', () => {
  const p = base('mokumo');
  const added = addRecord(p, { id: 'r1', count: 50, mode: 'one', date: '2026-07-26', now: NOW });
  // grantedExp = 50 × 1 × 2 = 100
  const { player, result } = editRecord(added.player, { recordId: 'r1', count: 30, now: NOW });
  const entry = activeCharEntry(player);
  // 元exp(100) − 元grantedExp(100) + 30×1×2(=60) = 60
  assert.equal(entry.exp, 60);
  assert.equal(result.expDelta, -40); // 60 − 100
  assert.equal(result.estimated, false);
  assert.equal(result.charId, 'mokumo');
  const rec = player.records.find((r) => r.id === 'r1');
  assert.equal(rec.count, 30);
  assert.equal(rec.grantedExp, 60);
});

// 2026-07-29（欠陥Aの是正・当初方針への差し戻し）: 「before は常に、その日の
// 記録のうちそのキャラに紐づく grantedExp の**保存値**の合計」に統一した
// （isLegacyDay による日ごとの帳簿切り替えは廃止）。実装(js/core/player.js)は
// まだ変更されていない（このタスクの制約でテストだけを先に直す）ので、
// このテストは新しい期待値に対して現状の実装では FAIL する想定（それが目的）。
//
// 新しい導出: このケースは r1 が happa の唯一の記録（グループ＝全記録）。
// before は**保存値そのもの**（グループ内のリプレイではなく）＝3000。
// after は変更後の回数でこのグループを baseExp(=4384) から引き直した値。
//   before = 3000（保存値。すくすく込みの旧い計算結果がそのまま入っている）
//   after  = gain(count=100, charExp=4384) = 100×1×2(すくすく) = 200
//   diff = 200 − 3000 = −2800 → exp = 7384 − 2800 = 4584
// 「取り消した後のexp水準で特性を再判定する」という旧テスト名の主張自体は
// 「afterの計算にbaseExp(4384)を使う」という形で維持されるが、beforeを
// リプレイ値(100)ではなく保存値(3000)にしたことで、diffの符号・大きさが変わる。
test('editRecord: 特性の再判定は「取り消した後」のexp水準で行う（2026-07-29 beforeは常に保存値の方針に差し戻し）', () => {
  // はっぱ すくすく: Lv20以下で2倍。Lv20到達=4384EXP、Lv21到達=5043EXP
  // （gain.test.js で確認済みの既知の値）
  const p = base('happa');
  p.chars[0].exp = 4384 + 3000; // 7384。baseExp(4384)+この記録の保存値(3000)
  p.records = [
    { id: 'r1', date: '2026-07-26', mode: 'one', count: 50, createdAt: NOW, charId: 'happa', grantedExp: 3000 },
  ];
  const { player, result } = editRecord(p, { recordId: 'r1', count: 100, now: NOW });
  // before = 3000（保存値、常に） / after = 100×1×2(すくすく,baseExp=4384) = 200
  // diff = 200 − 3000 = −2800 → exp = 7384 − 2800 = 4584
  assert.equal(result.expDelta, -2800);
  assert.equal(activeCharEntry(player).exp, 4584);
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 200);
});

// ---------------------------------------------------------------------------
// 受け入れ条件3: 新データの削除
// ---------------------------------------------------------------------------

test('deleteRecord: 新データを削除すると grantedExp が引かれ records から消え、統計が再計算される', () => {
  const p = base('mokumo');
  let cur = addRecord(p, { id: 'r1', count: 20, mode: 'one', date: '2026-07-26', now: NOW }).player; // grantedExp=40
  cur = addRecord(cur, { id: 'r2', count: 30, mode: 'one', date: '2026-07-27', now: NOW }).player; // grantedExp=60
  const before = activeCharEntry(cur).exp; // 40+60=100
  assert.equal(before, 100);

  const { player, result } = deleteRecord(cur, { recordId: 'r1', now: NOW });
  assert.equal(player.records.some((r) => r.id === 'r1'), false);
  assert.equal(activeCharEntry(player).exp, before - 40);
  assert.equal(result.expDelta, -40);
  assert.equal(result.evolvedTo, null);
  // personalBest（自己ベスト）が削除後の状態から再計算される
  assert.equal(personalBest(player.records, 'one'), 30);
});

// ---------------------------------------------------------------------------
// 受け入れ条件4・5: 旧データの推定方式・格上げ
// ---------------------------------------------------------------------------

test('editRecord: 旧データ（charId/grantedExpなし）を直すと、いま育成中のキャラのexpが推定方式で動く', () => {
  const p = base('mokumo');
  p.chars[0].exp = 100;
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'one', count: 20, createdAt: NOW }]; // 旧データ

  const { player, result } = editRecord(p, { recordId: 'old1', count: 35, now: NOW });
  // others=[]（この記録しかない）
  // oldEstimate = 20×1×2 = 40 → entry.exp = max(0,100-40) = 60
  // newEstimate = 35×1×2 = 70 → entry.exp = 60+70 = 130
  assert.equal(activeCharEntry(player).exp, 130);
  assert.equal(result.estimated, true);
  assert.equal(result.expDelta, 70 - 40);
});

test('editRecord: 旧データを直すと新データに格上げされ、2回目の修正は正確な方式（estimated=false）になる', () => {
  const p = base('mokumo');
  p.chars[0].exp = 100;
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'one', count: 20, createdAt: NOW }];

  const first = editRecord(p, { recordId: 'old1', count: 35, now: NOW });
  const rec1 = first.player.records.find((r) => r.id === 'old1');
  assert.equal(rec1.charId, 'mokumo');
  assert.equal(rec1.grantedExp, 70);
  assert.equal(first.result.estimated, true);

  const second = editRecord(first.player, { recordId: 'old1', count: 40, now: NOW });
  assert.equal(second.result.estimated, false);
  // 正確な方式: entry.exp(130) − grantedExp(70) + 40×1×2(=80) = 140
  assert.equal(activeCharEntry(second.player).exp, 140);
});

test('deleteRecord: 旧データの削除でも、いま育成中のキャラのexpが推定方式で減る', () => {
  const p = base('mokumo');
  p.chars[0].exp = 100;
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'one', count: 20, createdAt: NOW }];

  const { player, result } = deleteRecord(p, { recordId: 'old1', now: NOW });
  // oldEstimate = 20×1×2 = 40 → entry.exp = max(0,100-40) = 60
  assert.equal(activeCharEntry(player).exp, 60);
  assert.equal(result.estimated, true);
  assert.equal(result.expDelta, -40);
  assert.equal(player.records.some((r) => r.id === 'old1'), false);
});

// ---------------------------------------------------------------------------
// 受け入れ条件6: exp は 0 未満にならない（推定額が実際のexpを超えるケース）
// ---------------------------------------------------------------------------

test('deleteRecord: 旧データの推定額が実際のexpより大きくても、expは0未満にならない', () => {
  const p = base('hinoko');
  p.chars[0].exp = 5; // ほとんど残っていない
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'no', count: 10, createdAt: NOW }]; // 旧データ
  // oldEstimate = 10×3×1.5（自己ベスト更新なのでもえあがる発動）= 45 > entry.exp(5)
  const { player } = deleteRecord(p, { recordId: 'old1', now: NOW });
  assert.equal(activeCharEntry(player).exp, 0, '0未満にならない');
});

// 2026-07-28（2回目）: 対称なbefore/afterリプレイ方式への移行にともなう書き換え。
//
// 旧期待値(exp=5)は「oldEstimateを引いて0にクランプしたあと、その0を基準に
// newEstimateを足す」という中間クランプに依存していた（欠陥2そのもの）。
// 新方式はクランプを最終結果1回だけに遅らせるので、負債(-40)はクランプで
// 消えずに最後まで持ち越される:
//   before = gain(count=10, acc=[]) = 10×3×1.5(もえあがる) = 45
//   after  = gain(count=1,  acc=[]) = round(1×3×1.5) = 5
//   diff = 5-45 = -40 → exp = max(0, 5-40) = 0
// 旧方式は「0+5=5」という、実際には存在しない5EXPを生んでいた（欠陥2）。
test('editRecord: 旧データの推定額が実際のexpより大きくても、取り消し後のexpは0未満にならない（新方式でクランプは最後の1回だけ）', () => {
  const p = base('hinoko');
  p.chars[0].exp = 5;
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'no', count: 10, createdAt: NOW }];
  const { player, result } = editRecord(p, { recordId: 'old1', count: 1, now: NOW });
  assert.ok(activeCharEntry(player).exp >= 0, '負にならない');
  assert.equal(activeCharEntry(player).exp, 0, '中間クランプがないので0+5にならず0のまま（欠陥2）');
  assert.equal(result.expDelta, -5);
});

// ---------------------------------------------------------------------------
// 受け入れ条件7: レベルが下がることは許容する
// ---------------------------------------------------------------------------

test('editRecord: EXPが減ってレベルが下がることを許容する（禁止処理が入っていないことの確認）', () => {
  const p = base('mokumo');
  const added = addRecord(p, { id: 'r1', count: 1000, mode: 'one', date: '2026-07-26', now: NOW }).player;
  const levelBefore = levelFromExp(activeCharEntry(added).exp).level;
  assert.ok(levelBefore > 1, '前提: レベルが上がっていること');

  const { player, result } = editRecord(added, { recordId: 'r1', count: 1, now: NOW });
  assert.ok(result.levelAfter < result.levelBefore, 'レベルが下がってよい');
  assert.equal(activeCharEntry(player).exp, 2); // 0(取り消し後) + round(1×1×2)
});

// ---------------------------------------------------------------------------
// 受け入れ条件8: displayStageOf のラチェット
//
// 2026-07-28（安部さんの判断・進化の意味論そのものを変える改訂）: displayStageOf の
// 定義を変更。旧定義は Math.max(stageOf, 0, ...evolvedStages) だったため、
// 育成中でないキャラ（控え）でも「潜在段階」（生の stageOf。プレイヤー共通の
// 自己ベスト・連続日数と、そのキャラ固有のレベルのANDで決まる判定用の値。
// 意味は変えていない）が高ければ、EXPを1も受け取っていなくても絵だけ進化後に
// なってしまっていた（1体しかEXPは付与できないのに複数体が同時に進化して見える
// 症状の core 側の原因）。
//
// 新定義: displayStageOf = 「実現段階」= Math.max(0, ...evolvedStages)（0〜2に丸め）。
// stageOf を一切見ない。evolvedStages に追記されるのは、
//   - commitRecord（普段の記録）: 育成中のキャラだけ
//   - applyRecordChange（なおす／けす）: 育成中のキャラだけ（兄弟のEXP増減は
//     charChanges に載るが evolvedStages には追記しない。test/recordEditSymmetric.test.js
//     の I8・I9 を参照）
//   - switchChar（新規）: 切り替えた瞬間、切り替え先の潜在段階が実現段階を
//     上回っていれば追記する（test/evolutionGating.test.js の G2 を参照）
// のいずれかのタイミングだけ。「絵が変わるのは、育成中に切り替えたその瞬間」という
// 安部さんの決定を、displayStageOf のこの定義変更が体現している。
// ---------------------------------------------------------------------------

test('displayStageOf: evolvedStages の最高段階を返す（旧仕様と同じ数値のまま維持）', () => {
  const p = base('hinoko');
  p.chars[0].exp = 0; // 生の stageOf は 0
  p.chars[0].evolvedStages = [1, 2];
  assert.equal(stageOf(p, 'hinoko'), 0);
  assert.equal(displayStageOf(p, 'hinoko'), 2, 'evolvedStagesの最高値。ここは旧仕様から変わらない');
});

// 旧テスト「生の stageOf がラチェットより高ければそのまま返す」は反転する。
// 旧定義は stageOf を見ていたので、evolvedStages が空でも「潜在段階が2まで満たしている」
// だけで displayStageOf が2を返してしまっていた。これはまさに安部さんが指摘した
// 症状そのもの（EXPを渡していないキャラの絵が黙って進化後になる）なので、
// 新定義ではこのケースは 0 になるべき（evolvedStages に追記された実績が無いため）
test('displayStageOf: stageOf（潜在段階）が高くても evolvedStages（実現段階）が空なら 0（安部さんの指摘そのものの回帰網）', () => {
  const p = base('hinoko');
  p.chars[0].exp = totalExpForLevel(45);
  p.chars[0].evolvedStages = []; // 一度も「育成中に切り替えて条件を満たした」ことがない
  p.records = [];
  for (let d = 1; d <= 14; d += 1) {
    p.records.push({
      id: `r${d}`, date: `2026-07-${String(d).padStart(2, '0')}`, mode: 'no', count: 40, createdAt: NOW,
    });
  }
  assert.equal(stageOf(p, 'hinoko'), 2, '潜在段階（判定用）は2のまま。意味は変えない');
  assert.equal(displayStageOf(p, 'hinoko'), 0, '実現段階（絵に使う値）は、evolvedStagesが空なら0（旧仕様なら2を返し、これがバグだった）');
});

test('displayStageOf: evolvedStages が空で stageOf も0なら0（両方0で一致する自明ケース）', () => {
  const p = base('hinoko');
  p.chars[0].exp = 0;
  p.chars[0].evolvedStages = [];
  assert.equal(stageOf(p, 'hinoko'), 0);
  assert.equal(displayStageOf(p, 'hinoko'), 0);
});

// G9相当（ずかん・パーティのヒント用の判定）: 潜在段階(stageOf) > 実現段階(displayStageOf)
// のときが「そだてると しんかしそう」の合図になる。同じ core の2関数の比較だけで
// 判定できることを固定する（新しい専用関数を増やさなくても済む設計であることの確認）
test('displayStageOf と stageOf: 潜在段階が実現段階を上回っているかどうかで「しんかしそう」を判定できる', () => {
  const p = base('hinoko');
  p.chars[0].exp = totalExpForLevel(45);
  p.chars[0].evolvedStages = [];
  p.records = [];
  for (let d = 1; d <= 14; d += 1) {
    p.records.push({
      id: `r${d}`, date: `2026-07-${String(d).padStart(2, '0')}`, mode: 'no', count: 40, createdAt: NOW,
    });
  }
  assert.ok(stageOf(p, 'hinoko') > displayStageOf(p, 'hinoko'), '控えのまま潜在段階が先行しているので、ヒントを出せるはず');

  const evolved = { ...p, chars: [{ ...p.chars[0], evolvedStages: [1, 2] }] };
  assert.ok(!(stageOf(evolved, 'hinoko') > displayStageOf(evolved, 'hinoko')), '実現済みならヒントは出ない');
});

// ---------------------------------------------------------------------------
// 受け入れ条件9・10: 進化演出のトリガー条件
// ---------------------------------------------------------------------------

test('editRecord: 回数を増やす訂正で新たに進化段階に到達すると evolvedTo が返り evolvedStages に追記される', () => {
  // がんろ 第1進化: Lv10 / ノー10 or ワン35 / 連続20日
  const p = base('ganro');
  p.chars[0].exp = totalExpForLevel(10);
  p.records = [];
  for (let d = 1; d <= 20; d += 1) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    p.records.push({ id: `r${d}`, date, mode: 'no', count: 3, createdAt: NOW, charId: 'ganro', grantedExp: 0 });
  }
  assert.equal(stageOf(p, 'ganro'), 0, '前提: まだ進化していない');

  const first = editRecord(p, { recordId: 'r20', count: 10, now: NOW });
  assert.equal(first.result.evolvedTo, 1);
  assert.deepEqual(activeCharEntry(first.player).evolvedStages, [1]);

  const second = editRecord(first.player, { recordId: 'r20', count: 11, now: NOW });
  assert.equal(second.result.evolvedTo, null, '同じ進化を二度検知してはいけない');
});

test('editRecord(減額)・deleteRecord: 進化段階が下がっても evolvedTo は null（そもそも判定しない）', () => {
  const p = base('ganro');
  p.chars[0].exp = totalExpForLevel(10);
  p.records = [];
  for (let d = 1; d <= 19; d += 1) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    p.records.push({ id: `r${d}`, date, mode: 'no', count: 3, createdAt: NOW, charId: 'ganro', grantedExp: 0 });
  }
  p.records.push({
    id: 'r20', date: '2026-07-20', mode: 'no', count: 10, createdAt: NOW, charId: 'ganro', grantedExp: 0,
  });
  assert.equal(stageOf(p, 'ganro'), 1, '前提: すでに進化している');

  const edited = editRecord(p, { recordId: 'r20', count: 2, now: NOW });
  assert.equal(edited.result.evolvedTo, null);
  assert.equal(stageOf(edited.player, 'ganro'), 0, '前提: 実際に段階は下がっている');

  const deleted = deleteRecord(p, { recordId: 'r20', now: NOW });
  assert.equal(deleted.result.evolvedTo, null);
});

// ---------------------------------------------------------------------------
// 受け入れ条件12（旧）→ 2026-07-28 仕様変更により「既知のクセ」は撤回。
//
// 安部さんの判断（2026-07-28）: 記録の修正・削除のあとは、その日・そのモードの
// グループを「grantedExp を持つ記録（新データ）だけ createdAt 順に空の状態から
// 適用し直す」。これにより、以前は「先頭寄りの記録を直しても差分が増えない」という
// 順序依存のクセが仕様として残っていたが、このクセは(新データが複数あるケースでは)
// 解消される。旧データが絡む場合の細部は下の「グループ再計算」セクションを参照。
// ---------------------------------------------------------------------------

test('editRecord: 8→12→5 の新データを先頭から直すと、グループ全体が空の状態から引き直される（旧クセの解消）', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 5, mode: 'no', date: '2026-07-01', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 36); // 8×3=24 + (12-8)×3=12 + 0

  const { player, result } = editRecord(cur, { recordId: 'r1', count: 9, now: NOW });
  // 新しい不変条件: [r1(9),r2(12),r3(5)] を createdAt 順に空の状態から適用し直す
  //   r1: delta=9-0=9  → 27
  //   r2: delta=12-9=3 → 9
  //   r3: delta=max(0,5-12)=0 → 0
  // 合計は 36（= 3×max(9,12,5)）で「日別ベスト相当」は変わらないが、
  // r1 自身の grantedExp は 0 → 27 に変わる（旧クセでは 0 のままだった）
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 27);
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 9, '直接編集していない兄弟記録も引き直される');
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 0);
  assert.equal(activeCharEntry(player).exp, 36);
  assert.equal(result.expDelta, 0); // 36(引き直し後) − 36(直す前)
});

// 2026-07-28（2回目）: 対称なbefore/afterリプレイ方式への移行にともなう、
// このテストの前提そのものの反転。
//
// このテストの元々の主張（「新データの兄弟がいない旧データのみのグループは
// 再計算されない」）は、旧アルゴリズムの `groupMembers` が
// `Number.isFinite(r.grantedExp)` でしか対象を絞れなかった実装都合の
// 副作用であり、まさに defect1（時間文脈の欠陥）と同根だった。
// 新方式の item1「メンバー = そのグループの全記録（新データも旧データも）」
// はこれを覆す。r1(対象自身)は旧データでも必ずカウントされ、
// createdAt順（この fixture では配列の並び順=r1,r2,r3が同値タイブレーク）で
// 空の状態からリプレイされる:
//   r1が配列先頭＝最も早い扱いなので、r1自身の文脈(acc)は常に空。
//   before: r1(8,acc=[])=8×3=24 → r1自身は対象なので合計に加算
//   after : r1(9,acc=[])=9×3=27
//   diff = 27-24 = 3 → exp = max(0, 100+3) = 103
// r2,r3(対象ではない旧データの兄弟)は、r1の後に生成された扱いなので
// r1の文脈には現れず、かつ対象でもないのでどのキャラの合計にも
// 加算されない（グループ再計算8と同じ「旧データの兄弟は寄与ゼロ」の原則）。
// そのためr2,r3自身は今回も格上げされない（charId/grantedExpは書かれない）。
test('editRecord（対称リプレイ方式で反転）: 旧データのみのグループでも、対象自身(R)はcreatedAt順でリプレイされ再計算される', () => {
  const p = base('mokumo');
  p.chars[0].exp = 100;
  p.records = [
    { id: 'r1', date: '2026-07-01', mode: 'no', count: 8, createdAt: NOW },
    { id: 'r2', date: '2026-07-01', mode: 'no', count: 12, createdAt: NOW },
    { id: 'r3', date: '2026-07-01', mode: 'no', count: 5, createdAt: NOW },
  ];
  const { player, result } = editRecord(p, { recordId: 'r1', count: 9, now: NOW });
  assert.equal(activeCharEntry(player).exp, 103, '旧方式の「変わらない(100)」は defect1 と同根のクセだった');
  assert.equal(result.expDelta, 3);
  assert.equal(result.estimated, true);
  const rec1 = player.records.find((r) => r.id === 'r1');
  assert.equal(rec1.charId, 'mokumo', 'r1(対象自身)は格上げされる');
  assert.equal(rec1.grantedExp, 27);
  assert.equal(rec1.originalCount, 8);
  // 兄弟(旧データ、対象ではない)は、値の計算には(文脈として)関与しうるが、
  // それ自身は格上げされない（グループ再計算8と同じ原則）
  assert.equal(player.records.find((r) => r.id === 'r2').charId, undefined);
  assert.equal(player.records.find((r) => r.id === 'r3').charId, undefined);
});

// ---------------------------------------------------------------------------
// 2026-07-28 仕様変更（安部さんの判断）: 記録の修正・削除のあとの「グループ再計算」
//
// 新しい不変条件: 修正・削除のあと、その日・そのモードのグループについて、
// 「grantedExp を持つ記録（新データ）を createdAt 順に空の状態から適用し直したときの
// grantedExp の合計」と「実際にキャラへ入っている合計」が一致すること。
// 旧データ（grantedExp を持たない記録）はEXPを動かさないが、dailyBest の計算には
// 参加する（記録集合の一員として others に混じって残る）。
//
// 【このセクションのテストが前提にしている解釈（要確認）】
// 「対象記録R自身の扱いは従来どおり」は、(a)どのキャラのEXPを動かすか（新データなら
// 自分の charId、旧データなら activeCharId）と、(b) estimated/exact のラベル付け、
// の2点についてのみ「従来どおり」と読み、R自身の grantedExp の数値そのものは
// 「グループ全体を空の状態から引き直す」計算に含めて決める、という解釈で計算した。
// この解釈は、8→12→5の「先頭を直しても差分が増えない」という既知のクセが
// 「R自身についても解消される」という仕様変更の記述と整合させるために選んだもの。
// もし実装が「Rの数値だけは従来の単発diff式を維持し、兄弟だけ別途引き直す」という
// 別解釈を採る場合、このセクションの一部（特に test4・test5b・test9・test3系）は
// 数値が変わる可能性がある。test1・test2（削除系）はどちらの解釈でも同じ結果になる
// ため解釈非依存で信頼度が高い。
// ---------------------------------------------------------------------------

test('グループ再計算1（レビュアーの再現ケース）: ひのこ ノー10かい→12かい で低い方(10かい)を削除すると、残る12かいが単独で引き直され exp=54 になる', () => {
  const p = base('hinoko');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 10, mode: 'no', date: '2026-07-20', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW }).player;
  assert.equal(cur.records.find((r) => r.id === 'r1').grantedExp, 45); // 10×3×1.5
  assert.equal(cur.records.find((r) => r.id === 'r2').grantedExp, 9); // (12-10)×3×1.5
  assert.equal(activeCharEntry(cur).exp, 54);

  const { player, result } = deleteRecord(cur, { recordId: 'r1', now: NOW });
  assert.equal(player.records.some((r) => r.id === 'r1'), false);
  const rec2 = player.records.find((r) => r.id === 'r2');
  assert.equal(rec2.grantedExp, 54, '12かい単独としてベスト更新から引き直され45→54ではなく12×3×1.5=54になる');
  assert.equal(activeCharEntry(player).exp, 54, 'その日の価値が54→9に落ちてはいけない');
  assert.equal(result.expDelta, 0); // 54(引き直し後) − 54(削除前)
});

test('グループ再計算2: 逆に高い方(12かい)を削除すると、残る10かいが単独で引き直され exp=45 になる', () => {
  const p = base('hinoko');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 10, mode: 'no', date: '2026-07-20', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 54);

  const { player, result } = deleteRecord(cur, { recordId: 'r2', now: NOW });
  assert.equal(player.records.some((r) => r.id === 'r2'), false);
  const rec1 = player.records.find((r) => r.id === 'r1');
  assert.equal(rec1.grantedExp, 45, '10かい単独として引き直され10×3×1.5=45');
  assert.equal(activeCharEntry(player).exp, 45);
  assert.equal(result.expDelta, -9); // 45 − 54
});

test('グループ再計算3: 3件(8→12→5)の真ん中を編集しても、グループ合計は日別ベスト相当になる', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 5, mode: 'no', date: '2026-07-01', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 36);

  // r2(真ん中)を 12→6 に減らす。新しいカウント列 [8,6,5] を空の状態から引き直すと
  //   r1: 8-0=8 → 24 / r2: max(0,6-8)=0 → 0 / r3: max(0,5-8)=0 → 0
  const { player, result } = editRecord(cur, { recordId: 'r2', count: 6, now: NOW });
  const sum = player.records.filter((r) => r.date === '2026-07-01' && r.mode === 'no')
    .reduce((s, r) => s + r.grantedExp, 0);
  assert.equal(sum, 24, 'グループ合計は 3×max(8,6,5)=24（日別ベスト相当）');
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 24);
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 0);
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 0);
  assert.equal(activeCharEntry(player).exp, 24);
  assert.equal(result.expDelta, -12); // 24 − 36
});

test('グループ再計算4: 3件(8→12→5)の末尾を編集しても、グループ合計は日別ベスト相当になる', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 5, mode: 'no', date: '2026-07-01', now: NOW }).player;

  // r3(末尾)を 5→15 に増やす。新しいカウント列 [8,12,15] を引き直すと
  //   r1: 8 → 24 / r2: 12-8=4 → 12 / r3: 15-12=3 → 9
  const { player, result } = editRecord(cur, { recordId: 'r3', count: 15, now: NOW });
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 24, '直接編集していない先頭も不変');
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 12, '直接編集していない真ん中も不変');
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 9);
  assert.equal(activeCharEntry(player).exp, 45); // 3×max(8,12,15)=45
  assert.equal(result.expDelta, 9); // 45 − 36
});

test('グループ再計算5: 3件のうち先頭（ベストではない方）を削除しても合計は変わらない', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 5, mode: 'no', date: '2026-07-01', now: NOW }).player;

  const { player, result } = deleteRecord(cur, { recordId: 'r1', now: NOW });
  // 残る[12,5]を空の状態から引き直す: r2: 12→36 / r3: max(0,5-12)=0→0
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 36, 'ベストだったr2が単独計算で伸びる');
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 0);
  assert.equal(activeCharEntry(player).exp, 36); // 3×max(12,5)=36、削除前と同じ
  assert.equal(result.expDelta, 0);
});

test('グループ再計算6: 3件のうち真ん中（実はベストだった12）を削除すると合計が下がる', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 5, mode: 'no', date: '2026-07-01', now: NOW }).player;

  const { player, result } = deleteRecord(cur, { recordId: 'r2', now: NOW });
  // 残る[8,5]を引き直す: r1: 8→24 / r3: max(0,5-8)=0→0
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 24);
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 0);
  assert.equal(activeCharEntry(player).exp, 24); // 3×max(8,5)=24
  assert.equal(result.expDelta, -12); // 24 − 36
});

test('グループ再計算7: グループ内の記録が別々のキャラに紐づくとき、それぞれのキャラのEXPが個別に増減する', () => {
  const p = base('hinoko'); // activeCharId=hinoko を最初に使う
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  assert.equal(afterR1.player.records[0].charId, 'hinoko');
  // switchChar は 2026-07-28 の意味論変更で戻り値が { player, result } になった
  // （育成キャラの切り替えそのものが進化を検知しうるようになったため）。
  // このテストは切り替えの結果自体には興味がないので player だけ取り出す
  const switched = switchChar(afterR1.player, 'mokumo').player;
  const afterR2 = addRecord(switched, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW });

  const hinokoBefore = afterR2.player.chars.find((c) => c.charId === 'hinoko').exp;
  const mokumoBefore = afterR2.player.chars.find((c) => c.charId === 'mokumo').exp;
  assert.equal(hinokoBefore, 36); // 8×3×1.5(自己ベスト)
  assert.equal(mokumoBefore, 12); // (12-8)×3

  // r1(hinoko)を 8→10 に直す。グループ[r1(hinoko),r2(mokumo)]を空の状態から引き直す:
  //   r1: delta=10-0=10, 自己ベスト更新 → 10×3×1.5=45 → hinoko.exp=45
  //   r2: ctx=[r1(10)] → delta=12-10=2 → 2×3(もくもはノーに特性なし)=6 → mokumo.exp=6
  const { player, result } = editRecord(afterR2.player, { recordId: 'r1', count: 10, now: NOW });
  const hinokoAfter = player.chars.find((c) => c.charId === 'hinoko').exp;
  const mokumoAfter = player.chars.find((c) => c.charId === 'mokumo').exp;
  assert.equal(hinokoAfter, 45, 'hinokoは増える');
  assert.equal(mokumoAfter, 6, 'mokumoは（直接編集していないのに）減る');
  assert.equal(result.charId, 'hinoko');
  assert.equal(result.expDelta, 9); // 45 − 36
});

test('グループ再計算8: 旧データが混在しても、旧データのEXPは動かないが dailyBest の計算には参加する', () => {
  const p = base('mokumo');
  p.chars[0].exp = 24;
  p.records = [
    { id: 'old1', date: '2026-07-20', mode: 'no', count: 12, createdAt: '2026-07-20T09:00:00.000Z' }, // 旧データ
    {
      id: 'new1', date: '2026-07-20', mode: 'no', count: 20, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 24, // 元の計算: others=[old1(12)] → delta=20-12=8 → 8×3=24
    },
  ];

  const { player, result } = editRecord(p, { recordId: 'new1', count: 30, now: NOW });
  // old1(12) は others として残るので、new1 の delta は 30-12=18 → 18×3=54
  assert.equal(player.records.find((r) => r.id === 'new1').grantedExp, 54);
  assert.equal(activeCharEntry(player).exp, 54);
  assert.equal(result.expDelta, 30); // 54 − 24

  const old1 = player.records.find((r) => r.id === 'old1');
  assert.equal(old1.count, 12, '旧データの回数は不変');
  assert.equal(old1.charId, undefined, '旧データにcharIdは書き込まれない');
  assert.equal(old1.grantedExp, undefined, '旧データにgrantedExpは書き込まれない');
});

// 2026-07-28（2回目）: 対称なbefore/afterリプレイ方式への移行にともなう書き換え。
//
// 旧期待値(exp=60, expDelta=48)は「旧データRの推定(oldEstimate/newEstimate)を
// others=[r2(現在の回数)]という基準で先に加減してから、その後さらに
// recalcGroup（空の状態からの引き直し）を上書きで走らせる」という2段構えの
// 手順が生んだ二重計上だった（欠陥3）。
//
// 新方式ではR（旧データでも）はグループの他メンバーと全く同じ「対称な
// before/afterリプレイ」1回だけで扱う:
//   before: r1(8,対象。旧データだが対象自身は必ずカウントする)=acc=[]→8×3=24
//           r2(12,新データの兄弟。常にカウントする)=acc=[r1(8)]→(12-8)×3=12（元のgrantedExpと一致）
//           before合計 = 24+12 = 36
//   after : r1(20)=acc=[]→20×3=60
//           r2(12,未編集)=acc=[r1(20)]→max(0,12-20)=0×3=0
//           after合計 = 60+0 = 60
//   diff = 60-36 = 24 → exp = max(0, 12+24) = 36
test('グループ再計算9（対称リプレイ方式で書き換え）: 旧データ(R)を直すと、既に新データだった兄弟の grantedExp も引き直される', () => {
  const p = base('mokumo');
  p.chars[0].exp = 12; // r2(新データ)からの分だけ
  p.records = [
    { id: 'r1', date: '2026-07-20', mode: 'no', count: 8, createdAt: '2026-07-20T09:00:00.000Z' }, // 旧データ
    {
      id: 'r2', date: '2026-07-20', mode: 'no', count: 12, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 12, // 元の計算: others=[r1(8)] → delta=12-8=4 → 4×3=12
    },
  ];

  const { player, result } = editRecord(p, { recordId: 'r1', count: 20, now: NOW });
  const rec1 = player.records.find((r) => r.id === 'r1');
  const rec2 = player.records.find((r) => r.id === 'r2');
  assert.equal(rec1.charId, 'mokumo', '旧データが新データへ格上げされる');
  assert.equal(rec1.grantedExp, 60, 'r1自身のafter値（対称リプレイの結果）');
  assert.equal(rec1.originalCount, 8);
  assert.equal(rec2.grantedExp, 0, '直接編集していない新データの兄弟も引き直されて減る');
  assert.equal(activeCharEntry(player).exp, 36, '旧方式の60は二重計上だった（欠陥3）。正しくは36');
  assert.equal(result.estimated, true, 'Rは旧データだったので estimated');
  assert.equal(result.expDelta, 24); // 36 − 12
});

// 2026-07-28（EXP頭打ちルール）: このテストの前提そのものが変わった。
//
// 旧アサーション「r4(別のモード、同じ日)のgrantedExpは12のまま」は、
// 「同じ日ならモードをまたいで比較し、負けたモードのgrantedExpは0にする」という
// 新ルールと矛盾する。r1・r2(ノー)がその日(07-01)の合計36で、r4(ワン,同じ日)の
// soloValue(6)=12は36に負けているので、r4は最初からgrantedExp=0でなければならない
// （日別ベストが更新されても、日全体の勝者でなければEXPは増えない）。
//
// 「別の日(r3, 07-02)は変わらない」という主張自体は新ルールでも正しいので維持し、
// 「別のモードだが同じ日」の主張だけを新ルールの数値（0）に書き換える
test('グループ再計算10（EXP頭打ちルールで書き換え）: 別の日の記録は変わらないが、同じ日の別モードは日全体の勝敗に従う', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 8, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'r3', count: 10, mode: 'no', date: '2026-07-02', now: NOW }).player; // 別の日
  cur = addRecord(cur, { id: 'r4', count: 6, mode: 'one', date: '2026-07-01', now: NOW }).player; // 別のモード（同じ日）
  assert.equal(cur.records.find((r) => r.id === 'r3').grantedExp, 30); // 10×3（別日なのでベスト0から）
  // soloValue(no1+no2 合計)=36(3×max(8,12)) vs soloValue(one,6)=6×1×2=12 → その日の勝者はノー。
  // r4は日全体で負けているので、生の日別ベストが5→6等に更新されてもgrantedExpは0
  assert.equal(cur.records.find((r) => r.id === 'r4').grantedExp, 0, '同じ日のノー(36)に負けているのでワンは0（旧ルールでは12だった）');

  const { player } = deleteRecord(cur, { recordId: 'r1', now: NOW });
  assert.equal(player.records.find((r) => r.id === 'r3').grantedExp, 30, '別の日は変わらない');
  assert.equal(player.records.find((r) => r.id === 'r4').grantedExp, 0, '同じ日の別モードは、r1削除後もノー(残るr2=36)に負けたままなので0のまま');
});

// 2026-07-28（2回目）: 対称なbefore/afterリプレイ方式への移行にともなう書き換え。
//
// 旧期待値(exp=15)は「revokeで一旦0にクランプしてから、そのクランプ後の0を
// 基準にr1をもう一度満額(15)足す」という中間クランプに依存していた（欠陥2）。
// r2(count=8)はこのグループの「その日のベスト」だったので、r2を削除すれば
// グループの価値が 3×8=24 → 3×5=15 に本当に下がる（これは正当な減少）。
// しかしキャラの実際のexpは3しかなく、この正当な-9の減少をそのまま反映すると
// 0を割り込む。中間クランプなしで最後に1回だけクランプすると:
//   before: r1(5,acc=[])=15 / r2(8,acc=[r1(5)])=(8-5)×3=9 → before合計=24
//   after : r1(5,acc=[])=15（r2は削除で対象外）→ after合計=15
//   diff = 15-24 = -9 → exp = max(0, 3-9) = 0
// 旧方式の15は、クランプで失った負債(-21)を無視して生まれた水増しだった（欠陥2）。
test('グループ再計算11（対称リプレイ方式で書き換え）: 再計算後も exp は0未満にならない', () => {
  const p = base('mokumo');
  p.chars[0].exp = 3; // ほとんど残っていない
  p.records = [
    {
      id: 'r1', date: '2026-07-20', mode: 'no', count: 5, createdAt: '2026-07-20T09:00:00.000Z',
      charId: 'mokumo', grantedExp: 15,
    },
    {
      id: 'r2', date: '2026-07-20', mode: 'no', count: 8, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 9,
    },
  ];
  // 取り消し額の合計(15+9=24)が実際のexp(3)を大きく超える
  const { player, result } = deleteRecord(p, { recordId: 'r2', now: NOW });
  assert.ok(activeCharEntry(player).exp >= 0, '負にならない');
  // 中間クランプがないので、負債(-9)が最後まで持ち越されて0にクランプされる
  assert.equal(activeCharEntry(player).exp, 0, '旧方式の15はクランプで失った負債を無視した水増しだった（欠陥2）');
  assert.equal(result.expDelta, -3);
});

// 2026-07-28（EXP頭打ちルール）: このテストの主張そのものが反転した。
//
// 旧版は「同じ日でもノー・ワンは別グループなので、ノー側を直してもワン側の
// grantedExpは絶対に変わらない」ことを検証していた。しかし新ルールでは
// 「その日全体（両モード）」が1つのグループになり、日全体の勝者モードだけが
// EXPを受け取る。ノー側の編集で日全体の勝敗が変わるなら、ワン側のgrantedExpも
// 当然動く。旧版の数値（o1=10, o2=8 が編集後も不変）はこの新しい結合を
// 見落としたまま「独立している」と主張していたので、そのまま残すのは危険
// （実装がこの独立性を実装してしまうと、りょうほうの二重加算バグが再発する）。
//
// 新版では、あえて「ノー側の編集でワン側のEXPが動く」ケースを作って検証する
// （もし実装がまだモード単位でグループを分けていたら、この動きが起きずFAILする）
test('グループ再計算12（EXP頭打ちルールで反転）: 同じ日のノー側を編集して勝敗が反転すると、ワン側のgrantedExpも動く', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'n1', count: 10, mode: 'no', date: '2026-07-05', now: NOW }).player;
  cur = addRecord(cur, { id: 'o1', count: 5, mode: 'one', date: '2026-07-05', now: NOW }).player;
  // soloValue(no10)=30, soloValue(one5)=5×1×2=10 → 勝者はノー。ワンは0
  assert.equal(cur.records.find((r) => r.id === 'n1').grantedExp, 30);
  assert.equal(cur.records.find((r) => r.id === 'o1').grantedExp, 0, '同じ日でノー(30)に負けているのでワンは0');
  assert.equal(activeCharEntry(cur).exp, 30);

  // n1(ノー)を 10→2 に減らす。soloValue(no2)=6 < 10(ワン,soloValue(one5)=10) → 勝敗が反転する
  const { player, result } = editRecord(cur, { recordId: 'n1', count: 2, now: NOW });
  assert.equal(player.records.find((r) => r.id === 'n1').grantedExp, 0, 'ノーは負け側に転落して0になる');
  assert.equal(player.records.find((r) => r.id === 'o1').grantedExp, 10, 'ワンは(直接編集していないのに)勝者になって10を受け取る');
  assert.equal(activeCharEntry(player).exp, 10);
  assert.equal(result.expDelta, -20); // 10-30
});

test('グループ再計算13: editRecord/deleteRecord はグループ再計算があっても元のplayerを破壊しない（複数キャラ・複数記録）', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  const switched = switchChar(afterR1.player, 'mokumo').player; // 戻り値が {player,result} になった（下の注記参照）
  const afterR2 = addRecord(switched, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW });

  const before = JSON.parse(JSON.stringify(afterR2.player));
  editRecord(afterR2.player, { recordId: 'r1', count: 10, now: NOW });
  assert.deepEqual(afterR2.player, before, 'editRecordのドライランでplayerが変わらない');

  deleteRecord(afterR2.player, { recordId: 'r1', now: NOW });
  assert.deepEqual(afterR2.player, before, 'deleteRecordのドライランでplayerが変わらない');
});

// ---------------------------------------------------------------------------
// 受け入れ条件11: originalCount は初回修正時にだけ書き込む
// ---------------------------------------------------------------------------

test('editRecord: originalCount は初回修正時に書き込まれ、2回目以降は上書きされない', () => {
  const p = base('mokumo');
  p.records = [{ id: 'old1', date: '2026-07-26', mode: 'one', count: 20, createdAt: NOW }];

  const first = editRecord(p, { recordId: 'old1', count: 35, now: NOW });
  const rec1 = first.player.records.find((r) => r.id === 'old1');
  assert.equal(rec1.originalCount, 20);

  const second = editRecord(first.player, { recordId: 'old1', count: 12, now: NOW });
  const rec2 = second.player.records.find((r) => r.id === 'old1');
  assert.equal(rec2.originalCount, 20, '2回目の修正でも最初の回数のまま');
});

// ---------------------------------------------------------------------------
// 例外・非破壊（既存の addRecord/approvePending テストと同じ観点）
// ---------------------------------------------------------------------------

test('editRecord: 存在しない recordId は例外', () => {
  assert.throws(() => editRecord(base(), { recordId: 'nai', count: 5, now: NOW }), /nai/);
});

test('deleteRecord: 存在しない recordId は例外', () => {
  assert.throws(() => deleteRecord(base(), { recordId: 'nai', now: NOW }), /nai/);
});

test('editRecord: 元のプレイヤーを書き換えない', () => {
  const p = base('mokumo');
  const added = addRecord(p, { id: 'r1', count: 50, mode: 'one', date: '2026-07-26', now: NOW }).player;
  const before = JSON.parse(JSON.stringify(added));
  editRecord(added, { recordId: 'r1', count: 30, now: NOW });
  assert.deepEqual(added, before);
});

test('deleteRecord: 元のプレイヤーを書き換えない', () => {
  const p = base('mokumo');
  const added = addRecord(p, { id: 'r1', count: 50, mode: 'one', date: '2026-07-26', now: NOW }).player;
  const before = JSON.parse(JSON.stringify(added));
  deleteRecord(added, { recordId: 'r1', now: NOW });
  assert.deepEqual(added, before);
});

// ---------------------------------------------------------------------------
// 追加（実装者）: createdAt が同値のときの順序保証
//
// おうちのひとが短時間に続けて記録すると createdAt が完全一致しうる。
// グループ再計算は createdAt 順に適用するので、同値のときの並びが決まっていないと
// 「同じ操作なのに grantedExp の割り振りが変わる」ことになる。
// 実装は records 配列の並び順を第2キーにした安定ソートで決定的にしている。
// ---------------------------------------------------------------------------

test('グループ再計算: createdAt が同値のときは records 配列の並び順で適用され、結果が決定的になる', () => {
  const SAME = '2026-07-20T09:00:00.000Z';
  const mk = (id, count, grantedExp) => ({
    id, date: '2026-07-20', mode: 'no', count, createdAt: SAME, charId: 'mokumo', grantedExp,
  });
  // a(5)→15, b(12)→21 で合計36（= 3×max(5,12)）。整合の取れた初期状態
  const build = (reversed) => {
    const p = base('mokumo');
    p.chars[0].exp = 36;
    p.records = reversed ? [mk('b', 12, 21), mk('a', 5, 15)] : [mk('a', 5, 15), mk('b', 12, 21)];
    return p;
  };

  const forward = editRecord(build(false), { recordId: 'a', count: 6, now: NOW });
  assert.equal(forward.player.records.find((r) => r.id === 'a').grantedExp, 18, 'a が先なので a=6 が満額');
  assert.equal(forward.player.records.find((r) => r.id === 'b').grantedExp, 18);
  assert.equal(activeCharEntry(forward.player).exp, 36);

  const reversed = editRecord(build(true), { recordId: 'a', count: 6, now: NOW });
  assert.equal(reversed.player.records.find((r) => r.id === 'b').grantedExp, 36, 'b が先なので b=12 が満額');
  assert.equal(reversed.player.records.find((r) => r.id === 'a').grantedExp, 0);
  assert.equal(activeCharEntry(reversed.player).exp, 36, '割り振りは違っても合計は同じ');

  // 同じ入力を2回流したら必ず同じ結果になる（並びが実行ごとに揺れない）
  const again = editRecord(build(false), { recordId: 'a', count: 6, now: NOW });
  assert.deepEqual(again.player.records, forward.player.records);
});
