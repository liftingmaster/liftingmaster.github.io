import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecord, approvePending, editRecord, deleteRecord, activeCharEntry, switchChar,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { pickDayWinnerMode } from '../js/core/gain.js';

// =============================================================================
// EXP頭打ちルール（2026-07-28 安部さんの判断）の回帰網。
//
// 「りょうほう」（ノー・ワン同時記録）で両方やっても、その日のEXPは
// 「一番よかった記録1つぶん」だけ。docs参照: dualMode.test.js の巻頭コメント
// （このファイルと同じ解釈=モード単位でその日の勝者を1つ選ぶwinner-take-all）。
//
// このファイルは実装前に書いたテストなので、新ルールに対応する変更が
// player.js（addRecord/editRecord/deleteRecord/approvePending）に入るまでは
// 多くのテストが FAIL する想定（それが目的）。
// =============================================================================

const NOW = '2026-07-26T10:00:00.000Z';

const base = (starterId = 'mokumo') => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

// -----------------------------------------------------------------------------
// N3: 両方やっても、良いほう1つだけをやった場合より多くならない
// -----------------------------------------------------------------------------

test('N3-a: ぴかり(いなずま,ノー1.5倍) ノー10とワン30を両方記録しても、ノー10だけを記録した場合(45)より多くならない', () => {
  // soloValue(ノー10) = 10×3×1.5 = 45 / soloValue(ワン30) = 30×1×1 = 30
  const both = (() => {
    const p = base('pikari');
    const r1 = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW });
    return activeCharEntry(r2.player).exp;
  })();
  const onlyBest = (() => {
    const p = base('pikari');
    const r1 = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
    return activeCharEntry(r1.player).exp;
  })();
  assert.equal(onlyBest, 45);
  assert.equal(both, 45, '両方やっても、良いほう1つだけの場合と同じ（多くならない）');
  assert.ok(both <= onlyBest);
});

test('N3-b: こおる(れいせい,ノー20かい以上2倍) ノー25とワン25を両方記録しても、ノー25だけの場合(150)より多くならない', () => {
  // soloValue(ノー25) = 25×3×2(count>=20) = 150 / soloValue(ワン25) = 25×1×1 = 25
  const both = (() => {
    const p = base('kooru');
    const r1 = addRecord(p, { id: 'no1', count: 25, mode: 'no', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'one1', count: 25, mode: 'one', date: '2026-07-26', now: NOW });
    return activeCharEntry(r2.player).exp;
  })();
  const onlyBest = (() => {
    const p = base('kooru');
    const r1 = addRecord(p, { id: 'no1', count: 25, mode: 'no', date: '2026-07-26', now: NOW });
    return activeCharEntry(r1.player).exp;
  })();
  assert.equal(onlyBest, 150);
  assert.equal(both, 150, '両方やっても150より多くならない');
});

// -----------------------------------------------------------------------------
// N5: 同じモードの中の挙動は不変（回帰ガード）
// -----------------------------------------------------------------------------

test('N5: 同じモードだけの記録（ノー10→6→12）は新ルールでも +30/+0/+6 のまま', () => {
  const p = base('mokumo');
  const r1 = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-01', now: NOW });
  assert.equal(r1.result.exp, 30);
  const r2 = addRecord(r1.player, { id: 'r2', count: 6, mode: 'no', date: '2026-07-01', now: NOW });
  assert.equal(r2.result.exp, 0);
  const r3 = addRecord(r2.player, { id: 'r3', count: 12, mode: 'no', date: '2026-07-01', now: NOW });
  assert.equal(r3.result.exp, 6);
  assert.equal(activeCharEntry(r3.player).exp, 36);
  assert.equal(r3.player.records.find((r) => r.id === 'r1').grantedExp, 30);
  assert.equal(r3.player.records.find((r) => r.id === 'r2').grantedExp, 0);
  assert.equal(r3.player.records.find((r) => r.id === 'r3').grantedExp, 6);
});

// -----------------------------------------------------------------------------
// N6: 保存則。その日の全記録のgrantedExpの合計が、その日の最大値と一致する
// -----------------------------------------------------------------------------

test('N6: 保存則。ノー10→ワン5→ノー8→ワン40 の4件でも、grantedExpの合計は日の最大値と一致する', () => {
  // no側: dailyBest=10(8は更新しない) → soloValue(10)=30 → no側の日内配分は 30(no1)/0(no2)
  // one側: dailyBest=40 → soloValue(40)=40×1×2=80 → one側の日内配分は 10(one1,soloValue(5)=10)/70(one2,delta)
  // 勝者はワン(80>30)。ノー側は全部0になる
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 5, mode: 'one', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'no2', count: 8, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one2', count: 40, mode: 'one', date: '2026-07-26', now: NOW }).player;

  const dayRecords = cur.records.filter((r) => r.date === '2026-07-26');
  const sum = dayRecords.reduce((s, r) => s + r.grantedExp, 0);
  assert.equal(sum, 80, '合計はその日の最大値(80)と一致する');
  assert.equal(activeCharEntry(cur).exp, 80, 'キャラのexpも同じ80');

  assert.equal(cur.records.find((r) => r.id === 'no1').grantedExp, 0, 'ノーは負けたので両方0');
  assert.equal(cur.records.find((r) => r.id === 'no2').grantedExp, 0);
  assert.equal(cur.records.find((r) => r.id === 'one1').grantedExp, 10, 'ワンは勝者としてモード内の通常配分(10/70)を受け取る');
  assert.equal(cur.records.find((r) => r.id === 'one2').grantedExp, 70);
});

// -----------------------------------------------------------------------------
// N7: 別の日は影響を受けない
// -----------------------------------------------------------------------------

test('N7: りょうほうで日をまたぐと、別の日のEXPには影響しない', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'd1no', count: 10, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'd1one', count: 30, mode: 'one', date: '2026-07-01', now: NOW }).player;
  // 07-01: soloValue(no10)=30, soloValue(one30)=60 → 勝者one。day1合計=60
  assert.equal(activeCharEntry(cur).exp, 60);

  cur = addRecord(cur, { id: 'd2', count: 5, mode: 'no', date: '2026-07-02', now: NOW }).player;
  // 07-02: 単独記録なので勝者はノー自動的に。soloValue(no5)=15
  assert.equal(cur.records.find((r) => r.id === 'd2').grantedExp, 15);
  assert.equal(activeCharEntry(cur).exp, 75, '別の日の分がそのまま加算される');

  // 07-01のワンをさらに増やしても、07-02には影響しない
  const { player } = editRecord(cur, { recordId: 'd1one', count: 50, now: NOW });
  // soloValue(one50)=100。07-01合計は100に増える
  assert.equal(activeCharEntry(player).exp, 115, '07-01が60→100に増えた分だけ増える(75-60+100=115)');
  assert.equal(player.records.find((r) => r.id === 'd2').grantedExp, 15, '07-02は変わらない');
});

// -----------------------------------------------------------------------------
// N8: 承認ONでりょうほうを承認するとき、承認順に関係なく合計が最大値1つぶんになる
// -----------------------------------------------------------------------------

test('N8: 承認ONでノー10とワン30を承認する順序を変えても、合計は60でノー0/ワン60になる', () => {
  const buildQueued = () => {
    const p = base('mokumo');
    p.settings.approvalEnabled = true;
    let cur = p;
    cur = addRecord(cur, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
    cur = addRecord(cur, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW }).player;
    return cur;
  };

  // 順序A: ノーを先に承認
  const orderA = (() => {
    const queued = buildQueued();
    const afterNo = approvePending(queued, { pendingId: 'no1', count: 10, now: NOW });
    const afterOne = approvePending(afterNo.player, { pendingId: 'one1', count: 30, now: NOW });
    return afterOne.player;
  })();
  assert.equal(activeCharEntry(orderA).exp, 60);
  assert.equal(orderA.records.find((r) => r.id === 'no1').grantedExp, 0);
  assert.equal(orderA.records.find((r) => r.id === 'one1').grantedExp, 60);

  // 順序B: ワンを先に承認
  const orderB = (() => {
    const queued = buildQueued();
    const afterOne = approvePending(queued, { pendingId: 'one1', count: 30, now: NOW });
    const afterNo = approvePending(afterOne.player, { pendingId: 'no1', count: 10, now: NOW });
    return afterNo.player;
  })();
  assert.equal(activeCharEntry(orderB).exp, 60, '承認順序を変えても合計は同じ60');
  assert.equal(orderB.records.find((r) => r.id === 'no1').grantedExp, 0);
  assert.equal(orderB.records.find((r) => r.id === 'one1').grantedExp, 60);
});

// -----------------------------------------------------------------------------
// N9: 往復不変。両モードが同じ日にある状態で count を X→Y→X と直すと元に戻る
// -----------------------------------------------------------------------------

test('N9: 往復不変。ワンの回数を5→50→5と直すと、ノー・ワン両方のgrantedExpとexpが元に戻る', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 5, mode: 'one', date: '2026-07-26', now: NOW }).player;
  // soloValue(no10)=30, soloValue(one5)=10 → 勝者はノー。ワンは0
  assert.equal(activeCharEntry(cur).exp, 30);
  assert.equal(cur.records.find((r) => r.id === 'no1').grantedExp, 30);
  assert.equal(cur.records.find((r) => r.id === 'one1').grantedExp, 0);

  const up = editRecord(cur, { recordId: 'one1', count: 50, now: NOW });
  // soloValue(one50)=100 > 30 → 勝者がワンへ反転。ノーは0落ち、ワンは100
  assert.equal(activeCharEntry(up.player).exp, 100);
  assert.equal(up.player.records.find((r) => r.id === 'no1').grantedExp, 0);
  assert.equal(up.player.records.find((r) => r.id === 'one1').grantedExp, 100);

  const back = editRecord(up.player, { recordId: 'one1', count: 5, now: NOW });
  assert.equal(activeCharEntry(back.player).exp, 30, '元の30に戻る');
  assert.equal(back.player.records.find((r) => r.id === 'no1').grantedExp, 30, 'ノーも元の30に戻る');
  assert.equal(back.player.records.find((r) => r.id === 'one1').grantedExp, 0, 'ワンも元の0に戻る');
});

// -----------------------------------------------------------------------------
// N10: 削除の単調性。高いほうを削除すると低いほうが繰り上がって残るが、
// 増えるのではなく減る方向になる
// -----------------------------------------------------------------------------

test('N10: ノー30(90)とワン30(60)がある日にノーを削除すると、その日は90→60に下がる（増えない）', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'no1', count: 30, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 90);
  assert.equal(cur.records.find((r) => r.id === 'one1').grantedExp, 0);

  const { player, result } = deleteRecord(cur, { recordId: 'no1', now: NOW });
  assert.equal(activeCharEntry(player).exp, 60, 'ワンが繰り上がって60になるが、削除前(90)より少ない');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 60, 'ワンが唯一のモードとして満額を受け取る');
  assert.equal(result.expDelta, -30, '削除でexpが増えることはない');
  assert.ok(result.expDelta <= 0, '削除の単調性: 増えてはいけない');
});

// -----------------------------------------------------------------------------
// N11: 「なおす／けす」で触った日は新ルールで計算し直される（過去のぶんが減る）。
// 安部さんが了解済みの挙動として固定する。
//
// ここでは「旧ルール（頭打ちなし）で両方に加算してしまった」過去の状態を
// 直接組み立てて、それを直す／消すと新ルールに引き直されて減ることを確認する。
// -----------------------------------------------------------------------------

test('N11-a（なおす）: 旧ルールで両方に加算済み(合計90)の日を編集すると、新ルールで60に引き直される', () => {
  const p = base('mokumo');
  p.chars[0].exp = 90; // 旧ルールでノー30+ワン60を両方もらってしまった状態を再現
  p.records = [
    {
      id: 'no1', date: '2026-07-20', mode: 'no', count: 10, createdAt: '2026-07-20T09:00:00.000Z',
      charId: 'mokumo', grantedExp: 30,
    },
    {
      id: 'one1', date: '2026-07-20', mode: 'one', count: 30, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 60,
    },
  ];

  // count を同じ値(30)に「なおす」だけでも、その日全体が新ルールで引き直される
  const { player, result } = editRecord(p, { recordId: 'one1', count: 30, now: NOW });
  assert.equal(activeCharEntry(player).exp, 60, '過去の分が90→60に減る（安部さんが了解済みの挙動）');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 0, 'ノーは新ルールでは負け側になり0に引き直される');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 60, 'ワンは勝者として60のまま');
  assert.equal(result.expDelta, -30);
});

test('N11-b（けす）: 旧ルールで両方に加算済み(合計90)の日で、無関係な削除をしても新ルールで60に引き直される', () => {
  const p = base('mokumo');
  p.chars[0].exp = 90;
  p.records = [
    {
      id: 'no1', date: '2026-07-20', mode: 'no', count: 10, createdAt: '2026-07-20T09:00:00.000Z',
      charId: 'mokumo', grantedExp: 30,
    },
    {
      id: 'one1', date: '2026-07-20', mode: 'one', count: 30, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 60,
    },
  ];

  // no1自身を消す（消した記録自身は0になるのが当然だが、残るone1側の値も
  // 新ルールで確定させる、という点を見る）
  const { player, result } = deleteRecord(p, { recordId: 'no1', now: NOW });
  assert.equal(activeCharEntry(player).exp, 60, '残るワンだけの日として引き直され60になる');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 60);
  assert.equal(result.expDelta, -30);
});

// -----------------------------------------------------------------------------
// N12: 兄弟キャラ（育成中でない）のEXPが、クロスモード・クロスキャラの
// 同日グループの引き直しで動いたとき、charChanges に載る
// -----------------------------------------------------------------------------

test('N12: ひのこ(ノー)ともくも(ワン,兄弟)が同じ日に記録し、ひのこを編集して勝敗が反転すると、もくものEXP変化がcharChangesに載る', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  // soloValue(ひのこ,ノー8,自己ベスト更新)=8×3×1.5=36。単独記録なのでこれが勝者
  assert.equal(afterR1.player.chars.find((c) => c.charId === 'hinoko').exp, 36);

  const switched = switchChar(afterR1.player, 'mokumo').player;
  const afterR2 = addRecord(switched, { id: 'r2', count: 12, mode: 'one', date: '2026-07-20', now: NOW });
  // soloValue(もくも,ワン12)=12×1×2=24 < 36(ひのこ,ノー) → ひのこが勝者のまま。もくもは0
  assert.equal(afterR2.player.chars.find((c) => c.charId === 'hinoko').exp, 36);
  assert.equal(afterR2.player.chars.find((c) => c.charId === 'mokumo').exp, 0, '前提: もくもはまだ0（ひのこに負けている）');

  // ひのこ(育成中でない、今の育成キャラはもくも)のr1を 8→4 に減らす。
  // soloValue(ひのこ,ノー4,自己ベスト更新)=4×3×1.5=18 < 24(もくも,ワン) → 勝敗が反転する
  const { player, result } = editRecord(afterR2.player, { recordId: 'r1', count: 4, now: NOW });
  const hinokoAfter = player.chars.find((c) => c.charId === 'hinoko').exp;
  const mokumoAfter = player.chars.find((c) => c.charId === 'mokumo').exp;
  assert.equal(hinokoAfter, 0, 'ひのこは負け側に転落して0になる');
  assert.equal(mokumoAfter, 24, 'もくもは(直接編集していないのに)勝者になって24を受け取る');

  assert.equal(result.charId, 'hinoko', '編集対象自身はひのこ');
  assert.equal(result.expDelta, -36); // 0-36

  const mokumoChange = result.charChanges.find((c) => c.charId === 'mokumo');
  assert.ok(mokumoChange, 'もくもの変化がcharChangesに載る（育成中でない兄弟キャラの変化の可視化）');
  assert.equal(mokumoChange.expDelta, 24, '直接編集していないもくもが+24動いたことが読み取れる');

  const hinokoChange = result.charChanges.find((c) => c.charId === 'hinoko');
  assert.ok(hinokoChange);
  assert.equal(hinokoChange.expDelta, -36);
});

// -----------------------------------------------------------------------------
// N13: レベル依存特性（すくすく）で、soloValue の評価水準が全記録共通であること。
// クロスモードの日を編集するときも、別の日にすでに積んだレベルの影響を
// 正しく除いた基準（その日の付与ぶんを除いた水準）で判定し直す
// -----------------------------------------------------------------------------

test('N13: はっぱ すくすく。クロスモードの日を後から編集しても、判定に使うレベルは「その日を記録していなかった水準」のまま', () => {
  // Lv20到達=4384EXP、Lv21到達=5043EXP（既存テストで確認済みの値）
  const p = base('happa');
  p.chars[0].exp = 4384; // ちょうどLv20

  let cur = p;
  // 07-01: ノー150とワン350を両方記録。soloValue(no150)@Lv20=900, soloValue(one350)@Lv20=700
  // 勝者はノー(900)。expは4384+900=5284になる
  cur = addRecord(cur, { id: 'no1', count: 150, mode: 'no', date: '2026-07-01', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 350, mode: 'one', date: '2026-07-01', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 5284);
  assert.equal(cur.records.find((r) => r.id === 'one1').grantedExp, 0);

  // 08-01: 別の日に2000かい記録。charExp=5284はLv21(>20)なのですくすくは乗らない
  // soloValue(no2000)@5284(Lv21)=2000×3=6000。単独記録なので勝者
  cur = addRecord(cur, { id: 'no2', count: 2000, mode: 'no', date: '2026-08-01', now: NOW }).player;
  assert.equal(activeCharEntry(cur).exp, 11284); // 5284+6000

  // 07-01のワンを 350→1000 に直す。判定に使う基準(baseExp)は「happaの全記録のgrantedExp
  // 合計(900+0+6000=6900)を今のexp(11284)から引いた値」=4384（08-01の後付けの伸びを
  // 除いた、07-01当時のLv20水準）で両モードを評価し直す必要がある
  //   soloValue(no150)@4384(Lv20)=900（変わらない）
  //   soloValue(one1000)@4384(Lv20すくすく×2)=1000×1×2=2000
  // 勝敗が反転（ワン2000 > ノー900）。07-01の合計は900→2000に増える
  const { player, result } = editRecord(cur, { recordId: 'one1', count: 1000, now: NOW });
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 0, 'ノーは負け側に転落');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 2000, 'ワンが勝者。すくすく(Lv20水準)がちゃんと乗っている');
  assert.equal(player.records.find((r) => r.id === 'no2').grantedExp, 6000, '別の日(08-01)は変わらない');
  assert.equal(activeCharEntry(player).exp, 12384); // 4384(基準) + 2000(07-01) + 6000(08-01)
  assert.equal(result.expDelta, 1100); // 12384-11284
});

// -----------------------------------------------------------------------------
// T1〜T5: 同値（タイ）の決着。安部さんの確定仕様にテストが無かったので追加した。
//
// モードごとのその日の付与額が**まったく同じ**とき、どちらを勝者にしても合計は
// 変わらないが、どの記録に grantedExp が乗るかは変わる。決定的にしておかないと
// 「入力の順番で結果が変わる」ことになるので、**タイのときは ノーバウンドを勝者**
// にする（ノーのほうが難しい技だから）。
//
// もくも: ノー ×3（特性なし）／ワン ×1×2（ふわふわ）
//   soloValue(ノー10) = 10×3   = 30
//   soloValue(ワン15) = 15×1×2 = 30   ← ちょうど同値
// -----------------------------------------------------------------------------

test('T1 タイ: ノー10(30)とワン15(30)が同値なら、ノーバウンドが勝者になる', () => {
  const p = base('mokumo');
  const afterNo = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  const { player, result } = addRecord(afterNo.player, { id: 'one1', count: 15, mode: 'one', date: '2026-07-26', now: NOW });

  assert.equal(activeCharEntry(player).exp, 30, '合計は「一番よかった記録1つぶん」＝30');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 30, 'タイはノーバウンドの勝ち');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 0);
  assert.equal(result.dayWinnerMode, 'no');
});

test('T2 タイ: 逆順（ワン15→ノー10）で入れても、勝者はやはりノーバウンド（順序不変）', () => {
  const p = base('mokumo');
  const afterOne = addRecord(p, { id: 'one1', count: 15, mode: 'one', date: '2026-07-26', now: NOW });
  assert.equal(afterOne.player.records.find((r) => r.id === 'one1').grantedExp, 30, '前提: 1件目は単独なので満額');

  const { player, result } = addRecord(afterOne.player, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(activeCharEntry(player).exp, 30, '合計は順序によらず30');
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 30, 'あとから入れてもタイならノーバウンドが勝つ');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 0, '先に満額をもらっていたワンが0に引き直される');
  assert.equal(result.dayWinnerMode, 'no');
});

test('T3 タイ: 編集でちょうど同値になったときも、ノーバウンドが勝者になる', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'one1', count: 30, mode: 'one', date: '2026-07-26', now: NOW }).player;
  // soloValue(ワン30)=60 > 30 なので、この時点の勝者はワン
  assert.equal(cur.records.find((r) => r.id === 'one1').grantedExp, 60);
  assert.equal(cur.records.find((r) => r.id === 'no1').grantedExp, 0);

  // ワンを 30→15 に直すと 30 対 30 のタイになる
  const { player, result } = editRecord(cur, { recordId: 'one1', count: 15, now: NOW });
  assert.equal(activeCharEntry(player).exp, 30);
  assert.equal(player.records.find((r) => r.id === 'no1').grantedExp, 30, 'タイなのでノーへ戻る');
  assert.equal(player.records.find((r) => r.id === 'one1').grantedExp, 0);
  assert.equal(result.dayWinnerMode, 'no');
  assert.equal(result.expDelta, -30);
});

test('T4 タイ: pickDayWinnerMode の決着表（同値・片側だけ・空）', () => {
  assert.equal(pickDayWinnerMode({ no: 30, one: 30 }), 'no', '同値はノーバウンド');
  assert.equal(pickDayWinnerMode({ no: 0, one: 0 }), 'no', '両方0でもノーバウンド（決定的にする）');
  assert.equal(pickDayWinnerMode({ no: 31, one: 30 }), 'no');
  assert.equal(pickDayWinnerMode({ no: 30, one: 31 }), 'one');
  assert.equal(pickDayWinnerMode({}), 'no', '記録がない日でも例外にせずノーバウンドを返す');
  assert.equal(pickDayWinnerMode({ one: 5 }), 'one');
});

test('T5: dayWinnerMode は「+0 EXP の理由」を画面が出し分けるために必ず返る', () => {
  const p = base('mokumo');
  const single = addRecord(p, { id: 'n1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(single.result.dayWinnerMode, 'no', 'モードが1つでも勝者は返る');

  const lost = addRecord(single.player, { id: 'n2', count: 3, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(lost.result.exp, 0);
  assert.equal(lost.result.dayWinnerMode, 'no', '同じモード内で0のときは勝者＝自分のモード（ベスト未満が理由）');

  const capped = addRecord(single.player, { id: 'o1', count: 5, mode: 'one', date: '2026-07-26', now: NOW });
  assert.equal(capped.result.exp, 0);
  assert.equal(capped.result.dayWinnerMode, 'no', 'モードが違うときは勝者＝別モード（頭打ちが理由）');

  // 承認待ちはEXPが動かないので勝敗もまだ決まらない
  const withApproval = base('mokumo');
  withApproval.settings.approvalEnabled = true;
  const queued = addRecord(withApproval, { id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(queued.result.dayWinnerMode, null);
});
