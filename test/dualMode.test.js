import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRecord, activeCharEntry } from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { dailyBest } from '../js/core/stats.js';

// 仕様: docs/superpowers/specs/2026-07-27-record-edit-and-dual-mode.md §4
// （2026-07-28 EXP頭打ちルールで全面書き換え）
//
// 安部さんの判断（2026-07-28）: 「りょうほう」（ノーバウンドとワンバウンドの
// 同時記録）で両方やっても、その日のEXPは「一番よかった記録1つぶん」だけになる。
//
//   soloValue(record) = 「これを単独でその日に記録したら何EXPになるか」
//   その日のEXP = max(soloValue) を全記録に渡って取った値
//
// 以前のバージョン（このファイルの旧内容）は「ノー/ワンの日別ベストは
// モードごとに完全に独立している」ことを前提に書かれていたが、この前提そのものが
// 安部さんの指摘（両方やると2倍もらえてしまう）で覆った。書き換えの詳細は
// このタスクの報告（口頭/コミットメッセージ参照）にまとめている。
//
// 【このファイルが前提にしている解釈（要確認）】
// N1の具体例（ノー10→ワン30で合計60、ノーのgrantedExpは0）を字面どおりに実現するには、
// 「モード単位でその日の勝者を1つ選び、勝者モードの記録だけに通常の日別ベスト差分方式を
// 適用し、負けたモードの記録は全部0にする」という2段構えの計算になる
// （モード内の複数記録への分配=既存方式そのまま、モード間の勝敗=新規のwinner-take-all）。
// この解釈は N1〜N13 のすべてと整合する一意の読み方として選んだが、
// タスク文の「加算額 = max(0, 追加後の最大値 − 追加前の最大値)」という定式化を
// 単純に時系列で毎回適用する読み方（ノー30+ワン30の分配になり、0/60ではなく30/30に
// なる）とは数値が食い違う。合計だけならどちらの読み方でも一致する（保存則は崩れない）。

const NOW = '2026-07-26T10:00:00.000Z';

const base = (starterId = 'mokumo') => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

// ---------------------------------------------------------------------------
// 構造は変わらない部分（記録は両方残る）
// ---------------------------------------------------------------------------

test('両モード記録: addRecord を no→one の順に適用すると records に2件、date共通・mode違いで入る', () => {
  const p = base('mokumo');
  const afterNo = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  const afterOne = addRecord(afterNo.player, { id: 'one1', count: 20, mode: 'one', date: '2026-07-26', now: NOW });
  const { player } = afterOne;
  assert.equal(player.records.length, 2, '記録そのものは両方残る（EXPだけ頭打ちにする）');
  assert.equal(player.records[0].mode, 'no');
  assert.equal(player.records[1].mode, 'one');
  assert.equal(player.records[0].date, '2026-07-26');
  assert.equal(player.records[1].date, '2026-07-26');
});

test('両モード記録: 承認ONで両モードを保存すると pending に2件、独立に積まれる', () => {
  const p = base('mokumo');
  p.settings.approvalEnabled = true;
  let cur = p;
  cur = addRecord(cur, { id: 'n1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'o1', count: 5, mode: 'one', date: '2026-07-26', now: NOW }).player;

  assert.equal(cur.pending.length, 2);
  assert.equal(cur.records.length, 0);
  assert.equal(activeCharEntry(cur).exp, 0);
  assert.deepEqual(cur.pending.map((q) => q.mode).sort(), ['no', 'one']);
});

test('両モード記録: 片方だけ入力（従来の単一モード）の挙動は変わらない', () => {
  const p = base('mokumo');
  const { player, result } = addRecord(p, { id: 'n1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(player.records.length, 1);
  assert.equal(result.exp, 30, 'その日にモードが1つしかなければ、そのモードが自動的に勝者になる');
});

// ---------------------------------------------------------------------------
// N1・N2: りょうほうで良いほう1つぶんだけになる。順序不変
// ---------------------------------------------------------------------------

test('N1: りょうほうでノー10→ワン30を記録すると、合計は60（ワンのぶんだけ）。ノーのgrantedExpは0になる', () => {
  // もくも: ノー×3(特性なし)、ワン×1×2(ふわふわ)
  // soloValue(ノー10) = 10×3 = 30 / soloValue(ワン30) = 30×1×2 = 60
  // その日の勝者はワン（60>30）。ノーは記録として残るがgrantedExpは0になる
  const p = base('mokumo');
  const afterNo = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  const { player, result } = addRecord(afterNo.player, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW });

  assert.equal(activeCharEntry(player).exp, 60, '合計は「一番よかった記録1つぶん」＝60');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 0, 'ノーの記録は残るがgrantedExpは0（ワンに負けた）');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 60, 'ワンが日の勝者として満額を受け取る');
  assert.equal(player.records.length, 2, '記録そのものは両方残る');
  assert.equal(result.exp, 60, 'ワンを追加した時点の result.exp も日全体の増分と一致する');
});

test('N2: 逆順（ワン30→ノー10）でも合計は60。順序不変', () => {
  const p = base('mokumo');
  const afterOne = addRecord(p, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW });
  const { player } = addRecord(afterOne.player, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });

  assert.equal(activeCharEntry(player).exp, 60, '順序を変えても合計は同じ60');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 0);
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 60);
});

test('N2-b: レベル依存特性（すくすく）がある場合でも、りょうほうの合計は適用順で変わらない（旧テストの反転）', () => {
  // はっぱ すくすく: Lv20以下で2倍。Lv20到達=4384EXP、Lv21到達=5043EXP
  //
  // 旧ルール（このテストの旧版）では「先に処理したモードがLv20のうちに
  // すくすくを使い切り、後に処理したモードはLv21超で通常倍率になる」ため
  // no→one と one→no で合計が変わっていた（1250 vs 1150）。
  // 新ルールでは、その日のsoloValue評価に使うcharExpは「その日の付与ぶんを
  // 除いた水準」を両モードに共通で使うため、この順序依存はそもそも起こらない。
  //
  // soloValue(ノー150) = 150×3×2(Lv20すくすく) = 900
  // soloValue(ワン350) = 350×1×2(Lv20すくすく) = 700
  // 勝者はノー(900)。順序に関係なく合計は常に900
  const p = base('happa');
  p.chars[0].exp = 4384; // ちょうどLv20
  const countNo = 150;
  const countOne = 350;

  const noFirst = (() => {
    const r1 = addRecord(p, { id: 'a1', count: countNo, mode: 'no', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'a2', count: countOne, mode: 'one', date: '2026-07-26', now: NOW });
    return activeCharEntry(r2.player).exp - 4384;
  })();

  const oneFirst = (() => {
    const r1 = addRecord(p, { id: 'b1', count: countOne, mode: 'one', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'b2', count: countNo, mode: 'no', date: '2026-07-26', now: NOW });
    return activeCharEntry(r2.player).exp - 4384;
  })();

  assert.equal(noFirst, 900, 'no→one の合計は900');
  assert.equal(oneFirst, 900, 'one→no でも合計は同じ900（旧テストは1250/1150で不一致だった）');
  assert.equal(noFirst, oneFirst, '順序に関係なく合計は一致する（安部さんの要件: 順序不変）');
});

// ---------------------------------------------------------------------------
// N4: ノーの方が高い場合は逆になる
// ---------------------------------------------------------------------------

test('N4: ノー30(90EXP) vs ワン30(60EXP) なら、その日は90でワンは0（逆のケース）', () => {
  // soloValue(ノー30) = 30×3 = 90 / soloValue(ワン30) = 30×1×2 = 60
  const p = base('mokumo');
  const afterNo = addRecord(p, { id: 'no1', count: 30, mode: 'no', date: '2026-07-26', now: NOW });
  const { player } = addRecord(afterNo.player, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW });

  assert.equal(activeCharEntry(player).exp, 90, 'ノーが勝者なので90');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 90);
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 0, 'ワンは負けたので0');
});

// ---------------------------------------------------------------------------
// 生の日別ベスト（stats.dailyBest）はモードごとに独立のまま。
// EXPだけが日単位で頭打ちになる、という区別を固定する
// （旧テスト「ノーバウンドとワンバウンドの日別ベストは互いに影響しない」の書き換え）
// ---------------------------------------------------------------------------

test('生の日別ベスト（記録・グラフ用）はモードごとに独立のまま。頭打ちになるのはEXPだけ', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'n1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  // n1のみ: 唯一の記録なので勝者はノー。soloValue(ノー10)=30
  assert.equal(activeCharEntry(cur).exp, 30);

  cur = addRecord(cur, { id: 'o1', count: 5, mode: 'one', date: '2026-07-26', now: NOW }).player;
  // soloValue(ワン5)=5×1×2=10 < 30(ノー) → ノーが勝者のまま。ワンはgrantedExp0
  assert.equal(dailyBest(cur.records, '2026-07-26', 'no'), 10, '生の日別ベスト(ノー)は独立して10のまま');
  assert.equal(dailyBest(cur.records, '2026-07-26', 'one'), 5, '生の日別ベスト(ワン)も独立して5のまま');
  assert.equal(cur.records.find((r) => r.id === 'o1').grantedExp, 0, 'EXPはノーに負けているので0');
  assert.equal(activeCharEntry(cur).exp, 30, 'EXPの合計はノーの30のまま（ワンの分は加算されない）');

  // 追加のノー（8、ベスト未満）: 生のベストにも影響せず、EXPも増えない
  const afterNo2 = addRecord(cur, { id: 'n2', count: 8, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(afterNo2.result.exp, 0, 'ノーのベスト未満なのでEXP0');
  assert.equal(dailyBest(afterNo2.player.records, '2026-07-26', 'one'), 5, 'ワンの生のベストは変わらない');
  assert.equal(activeCharEntry(afterNo2.player).exp, 30, '合計も変わらない');

  // 追加のワン（6、ワンの生のベストは5→6に更新される）
  const afterOne2 = addRecord(cur, { id: 'o2', count: 6, mode: 'one', date: '2026-07-26', now: NOW });
  assert.equal(dailyBest(afterOne2.player.records, '2026-07-26', 'no'), 10, 'ノーの生のベストは変わらない（モードごとの独立性は維持）');
  assert.equal(dailyBest(afterOne2.player.records, '2026-07-26', 'one'), 6, 'ワンの生のベストは6に更新される（記録としては独立）');
  // soloValue(ワン6)=6×1×2=12 < 30(ノー) → まだノーが勝者。o2のgrantedExpは0
  //
  // 旧ルールなら「ワンのモード内だけの日別ベスト差分」で(6-5)×1×2=2がここで加算されていた。
  // 新ルールでは日全体でノーに負けているので、記録としてのベスト更新はあっても
  // EXPには一切反映されない。ここが「両方やると2倍もらえる」バグの直接の裏返し
  assert.equal(afterOne2.result.exp, 0, '生のベストは更新されてもEXPは増えない（新ルールの核心）');
  assert.equal(activeCharEntry(afterOne2.player).exp, 30, 'EXP合計はノーの30のまま');
});
