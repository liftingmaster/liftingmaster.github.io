import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeCharEntry, maxLevelEver, playerView, stageOf, progressOf, displayName,
  addRecord, approvePending, rejectPending, switchChar, claimUnlock, setNickname,
  maxEvolvedStageEver, evolutionUnlockProgress,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { totalExpForLevel } from '../js/core/exp.js';
import { pendingUnlocks } from '../js/core/unlock.js';

const NOW = '2026-07-26T10:00:00.000Z';
const base = (starterId = 'mokumo') => {
  // もくもはノーバウンドに特性が乗らないので、EXP計算の検証がしやすい
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

test('activeCharEntry は育成中キャラを返す', () => {
  const p = base();
  assert.equal(activeCharEntry(p).charId, 'mokumo');
});

test('maxLevelEver は全キャラの最高レベル', () => {
  const p = base();
  p.chars = [
    { charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] },
    { charId: 'hinoko', nickname: null, exp: totalExpForLevel(30), unlockedAt: NOW, evolvedStages: [] },
  ];
  assert.equal(maxLevelEver(p), 30);
});

test('playerView は記録から導出した値を返す', () => {
  const p = base();
  p.records = [
    { id: 'r1', date: '2026-07-25', mode: 'no', count: 10, createdAt: NOW },
    { id: 'r2', date: '2026-07-26', mode: 'no', count: 14, createdAt: NOW },
    { id: 'r3', date: '2026-07-26', mode: 'one', count: 55, createdAt: NOW },
  ];
  const v = playerView(p, '2026-07-26');
  assert.equal(v.bestNo, 14);
  assert.equal(v.bestOne, 55);
  assert.equal(v.currentStreak, 2);
  assert.equal(v.longestStreak, 2);
  assert.equal(v.level, 1);
  assert.equal(v.charId, 'mokumo');
  assert.equal(v.pendingCount, 0);
});

test('playerView の pendingCount は承認待ち件数', () => {
  const p = base();
  p.pending = [{ id: 'q1', date: '2026-07-26', mode: 'no', count: 5, createdAt: NOW }];
  assert.equal(playerView(p, '2026-07-26').pendingCount, 1);
});

test('displayName はニックネーム優先', () => {
  const p = base();
  assert.equal(displayName(p, 'mokumo'), 'もくも');
  const p2 = setNickname(p, 'mokumo', 'モコ');
  assert.equal(displayName(p2, 'mokumo'), 'モコ');
});

test('setNickname は元のプレイヤーを書き換えない', () => {
  const p = base();
  const before = JSON.parse(JSON.stringify(p));
  setNickname(p, 'mokumo', 'モコ');
  assert.deepEqual(p, before);
});

test('addRecord: 承認OFFなら記録が確定しEXPが入る', () => {
  const p = base();
  const { player, result } = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(result.queued, false);
  assert.equal(result.exp, 30); // 10 × 3、もくもの特性はノーに乗らない
  assert.equal(result.isPersonalBest, true);
  assert.equal(player.records.length, 1);
  assert.equal(player.pending.length, 0);
  assert.equal(activeCharEntry(player).exp, 30);
});

test('addRecord: 承認ONなら承認待ちに入りEXPは0', () => {
  const p = base();
  p.settings.approvalEnabled = true;
  const { player, result } = addRecord(p, { id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(result.queued, true);
  assert.equal(result.exp, 0);
  assert.equal(player.records.length, 0);
  assert.equal(player.pending.length, 1);
  assert.equal(activeCharEntry(player).exp, 0);
});

test('addRecord: 承認ONでも既にある解放待ちを見逃さない', () => {
  const p = base();
  p.chars[0].exp = totalExpForLevel(10); // すでにLv10到達済み・未受取の解放がある
  p.settings.approvalEnabled = true;

  // pendingUnlocks は evolutionUnlockProgress を渡す第3引数が
  // ある。ここを省略すると、期待値(expected)と実装呼び出し(addRecord内)が
  // 「両辺そろって同じ間違いをする」ため、addRecord 側が将来この第3引数を
  // 落としても本テストは気づけない（テストの穴）。明示的に渡して両辺を揃える
  const expected = pendingUnlocks(
    maxLevelEver(p), p.chars.map((c) => c.charId), evolutionUnlockProgress(p),
  );
  assert.ok(expected.length > 0, 'テストの前提: 解放待ちがあること');

  const { result } = addRecord(p, { id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(result.queued, true);
  assert.deepEqual(result.unlocks, expected);
});

test('addRecord: レベルアップを検知する', () => {
  const p = base();
  const { result } = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(result.levelBefore, 1);
  assert.ok(result.levelAfter > 1, `30EXPあればLv1→Lv4程度になるはず（実際 ${result.levelAfter}）`);
});

test('addRecord: 元のプレイヤーを書き換えない', () => {
  const p = base();
  const before = JSON.parse(JSON.stringify(p));
  addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.deepEqual(p, before);
});

test('addRecord: 進化到達を検知し、二度目は検知しない', () => {
  // がんろ 第1進化: Lv10 / ノー10 or ワン35 / 連続20日
  const p = base('ganro');
  p.chars[0].exp = totalExpForLevel(10);
  // 連続20日ぶんの記録を作る
  p.records = [];
  for (let d = 1; d <= 20; d += 1) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    p.records.push({ id: `r${d}`, date, mode: 'no', count: 3, createdAt: NOW });
  }
  const first = addRecord(p, { id: 'rx', count: 10, mode: 'no', date: '2026-07-21', now: NOW });
  assert.equal(first.result.evolvedTo, 1);
  assert.deepEqual(activeCharEntry(first.player).evolvedStages, [1]);

  const second = addRecord(first.player, { id: 'ry', count: 11, mode: 'no', date: '2026-07-22', now: NOW });
  assert.equal(second.result.evolvedTo, null, '同じ進化を二度検知してはいけない');
});

test('addRecord: 解放待ちを返す', () => {
  const p = base();
  p.chars[0].exp = totalExpForLevel(10) - 1; // あと1EXPでLv10
  const { result } = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  assert.ok(result.levelAfter >= 10);
  assert.equal(result.unlocks.length, 1);
  assert.equal(result.unlocks[0].level, 10);
});

test('approvePending: 承認するとEXPが入り、pendingから消える', () => {
  const p = base();
  p.settings.approvalEnabled = true;
  const queued = addRecord(p, { id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;

  const { player, result } = approvePending(queued, { pendingId: 'q1', count: 10, now: NOW });
  assert.equal(result.exp, 30);
  assert.equal(player.pending.length, 0);
  assert.equal(player.records.length, 1);
  assert.equal(activeCharEntry(player).exp, 30);
});

test('approvePending: 回数を直して承認できる', () => {
  const p = base();
  p.settings.approvalEnabled = true;
  const queued = addRecord(p, { id: 'q1', count: 999, mode: 'no', date: '2026-07-26', now: NOW }).player;

  const { player, result } = approvePending(queued, { pendingId: 'q1', count: 12, now: NOW });
  assert.equal(player.records[0].count, 12);
  assert.equal(result.exp, 36); // 12 × 3
});

test('approvePending: 存在しないIDは例外', () => {
  assert.throws(() => approvePending(base(), { pendingId: 'nai', count: 5, now: NOW }), /nai/);
});

test('approvePending: 承認の順番を変えても合計EXPは同じ', () => {
  const p = base();
  p.settings.approvalEnabled = true;
  let withQueue = p;
  for (const [id, count] of [['q1', 8], ['q2', 12], ['q3', 5]]) {
    withQueue = addRecord(withQueue, { id, count, mode: 'no', date: '2026-07-26', now: NOW }).player;
  }

  const runOrder = (order) => {
    let cur = withQueue;
    let total = 0;
    for (const id of order) {
      const found = cur.pending.find((q) => q.id === id);
      const r = approvePending(cur, { pendingId: id, count: found.count, now: NOW });
      cur = r.player;
      total += r.result.exp;
    }
    return total;
  };

  const forward = runOrder(['q1', 'q2', 'q3']);
  assert.equal(forward, 36); // 日別ベスト12 × 3
  assert.equal(runOrder(['q3', 'q2', 'q1']), forward);
  assert.equal(runOrder(['q2', 'q1', 'q3']), forward);
});

// 2026-07-29（安部さんの判断・方針1で反転）:
// このテストは元々「ひのこ（自己ベストで倍率が変わる特性）では承認の順番で
// 合計EXPが変わる（99 vs 84）」という、順序依存を仕様として固定するテストだった。
//
// しかしこの順序依存こそが、commitRecord に入っていた「いま足した記録は
// createdAt が何であってもこのリプレイでは最後に置く」という例外（欠陥1）を
// 正当化する唯一の根拠になっていた。EXP頭打ちルール（2026-07-28）で
// 「その日全体をリプレイし直す」方式に変わった以上、承認の並び順は常に
// createdAt（記録した瞬間）で決まるべきで、「親がどのボタンを先に押したか」
// という後付けの操作順でEXPが変わってはいけない。そこで主張を反転させ、
// 承認の順番を変えても合計EXPが変わらないことを固定する。
//
// 期待値99は元のテストの「古い順」の値と同じ（q1=07-25が常にq2=07-26より
// createdAtで先に来るため、承認をどちらから処理しても最終的な並びは
// 古い順=q1→q2に固定され、結果は古い順と一致するはず）。
//
// 現状の実装は「いま承認した記録を無条件で最後に置く」例外が残っているため、
// 新しい順（q2→q1）で承認すると並びが q2,q1 のままになってしまい、
// 84 になる（このテストはFAILする想定＝欠陥1の再発検知）。
test('approvePending: ひのこ（自己ベストで倍率が変わる特性）でも承認の順番を変えても合計EXPは変わらない（方針1で反転）', () => {
  const p = base('hinoko');
  p.settings.approvalEnabled = true;

  // 別々の日の記録2件。q1(07-25)は常にq2(07-26)よりcreatedAtで先。
  // 承認の順番（親がどちらのボタンを先に押すか）ではなく、記録した時刻の順で
  // 決まるべき
  let withQueue = p;
  withQueue = addRecord(withQueue, {
    id: 'q1', count: 10, mode: 'no', date: '2026-07-25', now: '2026-07-25T10:00:00.000Z',
  }).player;
  withQueue = addRecord(withQueue, {
    id: 'q2', count: 12, mode: 'no', date: '2026-07-26', now: '2026-07-26T10:00:00.000Z',
  }).player;

  const runOrder = (order) => {
    let cur = withQueue;
    let total = 0;
    for (const id of order) {
      const found = cur.pending.find((q) => q.id === id);
      const r = approvePending(cur, { pendingId: id, count: found.count, now: NOW });
      cur = r.player;
      total += r.result.exp;
    }
    return total;
  };

  // 古い順（q1→q2）: 10 が自己ベスト（10×3×1.5=45）、次に 12 も自己ベスト（12×3×1.5=54）→99
  const forward = runOrder(['q1', 'q2']);
  assert.equal(forward, 99);
  // 新しい順（q2→q1）で承認しても、記録した時刻の順（q1が先）で評価されるので
  // 同じ99になるはず（親がどちらを先に押しても子供のEXPは変わらない）
  const reverse = runOrder(['q2', 'q1']);
  assert.equal(reverse, forward, '承認の順番を変えても合計EXPは変わらないはず（現状は84になる＝欠陥1の再発検知）');
});

test('approvePending: もくも（入力で倍率が変わらない特性）なら同じ条件でも順不同', () => {
  // 上のひのこのテストと同じ組み立てで、特性が効かないキャラなら順番によらないこと。
  // 「順不同が成り立つ条件」がキャラ側にあることを示す対
  const p = base('mokumo');
  p.settings.approvalEnabled = true;
  let withQueue = p;
  withQueue = addRecord(withQueue, {
    id: 'q1', count: 10, mode: 'no', date: '2026-07-25', now: '2026-07-25T10:00:00.000Z',
  }).player;
  withQueue = addRecord(withQueue, {
    id: 'q2', count: 12, mode: 'no', date: '2026-07-26', now: '2026-07-26T10:00:00.000Z',
  }).player;

  const runOrder = (order) => {
    let cur = withQueue;
    let total = 0;
    for (const id of order) {
      const found = cur.pending.find((q) => q.id === id);
      const r = approvePending(cur, { pendingId: id, count: found.count, now: NOW });
      cur = r.player;
      total += r.result.exp;
    }
    return total;
  };

  assert.equal(runOrder(['q1', 'q2']), 66);
  assert.equal(runOrder(['q2', 'q1']), 66);
});

test('rejectPending: 承認待ちを削除してもEXPは動かない', () => {
  const p = base();
  p.settings.approvalEnabled = true;
  const queued = addRecord(p, { id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  const after = rejectPending(queued, 'q1');
  assert.equal(after.pending.length, 0);
  assert.equal(after.records.length, 0);
  assert.equal(activeCharEntry(after).exp, 0);
});

// 2026-07-28（安部さんの判断・進化の意味論そのものを変える改訂）:
// switchChar は「育成キャラの切り替えが進化を検知しうる」ようになったため、
// 戻り値が player 単体から { player, result } に変わった。
// result.evolvedTo は「切り替えた瞬間に新しく進化したか」（null なら進化なし）。
test('switchChar: 育成キャラを切り替えても各キャラのEXPは保たれる（戻り値は{player,result}）', () => {
  let p = base();
  p = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  assert.equal(activeCharEntry(p).exp, 30);

  p = claimUnlock(p, 'hinoko', NOW);
  const switched1 = switchChar(p, 'hinoko');
  p = switched1.player;
  assert.equal(activeCharEntry(p).charId, 'hinoko');
  assert.equal(activeCharEntry(p).exp, 0, '新しいキャラはLv1から');
  assert.equal(switched1.result.charId, 'hinoko');
  assert.equal(switched1.result.stageBefore, 0);
  assert.equal(switched1.result.evolvedTo, null, 'Lv1のキャラが切り替えただけで進化するはずがない');

  const switched2 = switchChar(p, 'mokumo');
  p = switched2.player;
  assert.equal(activeCharEntry(p).exp, 30, '前のキャラのEXPは保たれる');
  assert.equal(switched2.result.evolvedTo, null);
});

test('switchChar: 手持ちにないキャラには切り替えられない', () => {
  assert.throws(() => switchChar(base(), 'kagero'), /kagero/);
});

test('switchChar: 潜在段階が実現段階以下なら進化を検知しない（すでに見せた進化を二重に演出しない）', () => {
  const p = base('hinoko');
  p.chars[0].exp = totalExpForLevel(45);
  p.chars[0].evolvedStages = [1, 2]; // すでに両方見せている
  p.records = [];
  for (let d = 1; d <= 14; d += 1) {
    p.records.push({
      id: `r${d}`, date: `2026-07-${String(d).padStart(2, '0')}`, mode: 'no', count: 40, createdAt: NOW,
    });
  }
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  const switched = switchChar(p, 'mokumo');
  const back = switchChar(switched.player, 'hinoko');
  assert.equal(back.result.evolvedTo, null, '同じ進化を二度検知してはいけない');
  const hinokoEntry = back.player.chars.find((c) => c.charId === 'hinoko');
  assert.deepEqual(hinokoEntry.evolvedStages, [1, 2], '追記されない');
});

test('claimUnlock: 新しいキャラはLv1・進化なしで加わる', () => {
  const p = claimUnlock(base(), 'pikari', NOW);
  const entry = p.chars.find((c) => c.charId === 'pikari');
  assert.deepEqual(entry, { charId: 'pikari', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  assert.equal(p.activeCharId, 'mokumo', '受け取っただけでは育成キャラは変わらない');
});

test('claimUnlock: すでに持っているキャラは重複しない', () => {
  assert.throws(() => claimUnlock(base(), 'mokumo', NOW), /mokumo/);
});

// =============================================================================
// 2026-07-30 安部さんの依頼: ぴかりの解放条件が「Lv30到達」から
// 「なかまの誰かが だい1しんか(stage:1)を実現した」に変わった。
// player.js の pendingUnlocks 呼び出し箇所（commitRecord・addRecordの承認待ち経路）
// が、実際に evolvedStages に積まれた最高段階を pendingUnlocks の第3引数として
// 渡していることを end-to-end で固定する。
// 判定に使うのは「実現した」evolvedStages であって stageOf（潜在段階）ではない
// （G1と同じく、控えのキャラが条件を満たしただけでは解放されない）。
// =============================================================================

test('P10 記録を追加して だい1しんか が実現した瞬間の result.unlocks に ぴかり が入る（commitRecord経由・end-to-end）', () => {
  // 御三家を先に3体とも持たせ、Lv10・Lv20のレベル由来の解放待ちが
  // 同時に混ざらないようにする（進化由来だけを見るため）
  const p = base('hinoko');
  p.chars.push({ charId: 'shizuku', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  p.chars.push({ charId: 'happa', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  // ひのこ 第1進化: レベル15 / ノー15 or ワン50 / 連続5にち
  p.chars[0].exp = totalExpForLevel(15);
  for (let d = 1; d <= 4; d += 1) {
    const date = `2026-07-0${d}`;
    p.records.push({
      id: `f${d}`, date, mode: 'no', count: 1, createdAt: `${date}T09:00:00.000Z`,
    });
  }
  assert.deepEqual(p.chars[0].evolvedStages, [], '前提: まだ だい1しんか を実現していない');

  const { player, result } = addRecord(p, {
    id: 'r5', count: 15, mode: 'no', date: '2026-07-05', now: '2026-07-05T09:00:00.000Z',
  });

  assert.equal(result.evolvedTo, 1, '前提: この記録で だい1しんか(stage1) を実現する');
  assert.deepEqual(player.chars.find((c) => c.charId === 'hinoko').evolvedStages, [1]);
  assert.ok(
    result.unlocks.some((u) => u.choices.includes('pikari')),
    'だい1しんか が実現した瞬間の result.unlocks に ぴかり が入っていない',
  );
});

test('P10-b addRecord: 承認ON でも、だい1しんか を実現済みのキャラがいれば ぴかり の解放待ちを見逃さない', () => {
  const p = base('hinoko');
  p.chars[0].evolvedStages = [1]; // 既にだい1しんかを実現済み
  p.settings.approvalEnabled = true;

  const { result } = addRecord(p, {
    id: 'q1', count: 10, mode: 'no', date: '2026-07-26', now: NOW,
  });

  assert.equal(result.queued, true, '前提: 承認待ちに入るだけでEXPは動かない');
  assert.ok(
    result.unlocks.some((u) => u.choices.includes('pikari')),
    'だい1しんか実現済みなら、承認待ちの時点でも ぴかり の解放待ちが見えるべき',
  );
});

test('P10-c stageOf（潜在段階）を満たしただけで evolvedStages に積まれていないキャラがいても、ぴかりは出ない（だい1しんかを「実現した」ことで判定する。stageOfで判定してはいけない）', () => {
  // しずく 第1進化: レベル12 / ノー10 or ワン35 / 連続10にち。
  // ひのこ(育成中) 第1進化: レベル15 / ノー15 or ワン50 / 連続5にち。
  // 両者ともレベル条件は最初から満たす(exp=9958でレベル26)。
  // ノー9かいを10日連続で記録し、最終日だけ12かいにすると
  //   しずく: ノー12>=10 かつ 連続10にち → 潜在段階(stageOf)が1になる
  //   ひのこ: ノー12<15 → まだ条件を満たさず、進化しない（実測で確認済み）
  // つまり「控えのキャラが条件を満たしただけ」で、誰も実現していない状況を作れる
  const p = base('hinoko');
  p.chars[0].exp = 9958;
  p.chars.push({ charId: 'shizuku', nickname: null, exp: 9958, unlockedAt: NOW, evolvedStages: [] });

  let cur = p;
  for (let d = 1; d <= 9; d += 1) {
    const date = `2026-07-0${d}`;
    cur = addRecord(cur, {
      id: `f${d}`, count: 9, mode: 'no', date, now: `${date}T09:00:00.000Z`,
    }).player;
  }
  const { player, result } = addRecord(cur, {
    id: 'r10', count: 12, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z',
  });

  assert.equal(result.evolvedTo, null, '前提: 育成中のひのこはこの記録では進化しない（実測: ノー12はまだ15未満）');
  const hinoko = player.chars.find((c) => c.charId === 'hinoko');
  const shizuku = player.chars.find((c) => c.charId === 'shizuku');
  assert.deepEqual(hinoko.evolvedStages, [], '前提: ひのこは実現していない');
  assert.deepEqual(shizuku.evolvedStages, [], '前提: しずくも実現していない（控えは条件を満たしても進化しない）');
  assert.equal(stageOf(player, 'shizuku'), 1, '前提: しずくの潜在段階(判定用)は1を満たしている');

  assert.ok(
    !result.unlocks.some((u) => u.choices.includes('pikari')),
    'だい1しんかを誰も「実現」していない（潜在段階だけ満たしている）ので、ぴかりは出てはいけない',
  );
});

test('stageOf と progressOf: 進化前は次の段階の進捗を返す', () => {
  const p = base('hinoko');
  assert.equal(stageOf(p, 'hinoko'), 0);
  const prog = progressOf(p, 'hinoko');
  assert.equal(prog.met, false);
  assert.equal(prog.items.length, 3);
});

test('progressOf: 最終形態に達していたら null', () => {
  const p = base('hinoko');
  p.chars[0].exp = totalExpForLevel(45);
  p.records = [];
  for (let d = 1; d <= 14; d += 1) {
    p.records.push({ id: `r${d}`, date: `2026-07-${String(d).padStart(2, '0')}`, mode: 'no', count: 40, createdAt: NOW });
  }
  assert.equal(stageOf(p, 'hinoko'), 2);
  assert.equal(progressOf(p, 'hinoko'), null);
});

// =============================================================================
// 2026-07-30 adversarial-reviewer 指摘（欠陥3・低）: maxEvolvedStageEver が
// evolvedStages に非数値を含む手編集バックアップを渡されると NaN を返す。
// displayStageOf（js/core/player.js:74-80）は同じ「evolvedStages から段階を
// 求める」処理で Number.isFinite フィルタと 0〜2 のクランプを持っているが、
// maxEvolvedStageEver（js/core/player.js:35-40）にはそれが無い。
//
// テスターが決めた仕様（丸め方）: displayStageOf と完全に同じ扱いに揃える。
//   1. 各キャラの evolvedStages を Number.isFinite でフィルタする
//      （真偽値・文字列・undefined は「実現した段階」として数えない）
//   2. フィルタ後の最大値を Math.max(0, ...) ・Math.min(2, ...) で 0〜2 に丸める
// この仕様のもとでは [true] は「1」ではなく「0」になる（現状の実装は
// Math.max の型強制で偶然1を返しているが、booleanは段階の数値として
// 扱うべきでないため、意図して displayStageOf と揃える）。
// =============================================================================

function playerWithEvolvedStages(stages) {
  return { chars: [{ charId: 'hinoko', exp: 0, evolvedStages: stages }] };
}

test('E1 maxEvolvedStageEver は非数値混入でも壊れず、0〜2に丸めた数値を返す（displayStageOfと同じ扱い）', () => {
  const cases = [
    [[1, 'x'], 1],
    [[undefined], 0],
    [[true], 0],
    [[1, 99], 2],
    [[], 0],
  ];
  for (const [stages, expected] of cases) {
    const value = maxEvolvedStageEver(playerWithEvolvedStages(stages));
    assert.ok(Number.isFinite(value), `evolvedStages=${JSON.stringify(stages)} で NaN/Infinity になってはいけない（実際: ${value}）`);
    assert.ok(value >= 0 && value <= 2, `evolvedStages=${JSON.stringify(stages)} は 0〜2 の範囲であるべき（実際: ${value}）`);
    assert.equal(value, expected, `evolvedStages=${JSON.stringify(stages)}`);
  }
});

test('E1-b evolutionUnlockProgress は第1・第2進化を実現したキャラ数を数える', () => {
  const player = {
    chars: [
      { charId: 'hinoko', exp: 0, evolvedStages: [1] },
      { charId: 'shizuku', exp: 0, evolvedStages: [1, 2] },
      { charId: 'happa', exp: 0, evolvedStages: [2] },
      { charId: 'pikari', exp: 0, evolvedStages: ['2', true] },
    ],
  };
  assert.deepEqual(evolutionUnlockProgress(player), {
    maxStage: 2,
    countByStage: { 1: 3, 2: 2 },
  });
});

test('E2 再現: 手編集バックアップ由来の非数値混入 evolvedStages（[1,"だい1しんか"]）でも、ぴかりの解放が正しく判定される（欠陥3の再現）', () => {
  const p = base('hinoko');
  // 実際にひのこがだい1しんかを実現している(1)うえに、手編集で紛れ込んだ
  // 非数値要素("だい1しんか")が混ざっているケース。
  // storage.js の検証は Array.isArray しか見ておらず要素は検証しないため、
  // このデータは読み込みを通過してしまう
  p.chars[0].evolvedStages = [1, 'だい1しんか'];

  const value = maxEvolvedStageEver(p);
  assert.ok(Number.isFinite(value), `NaN になってはいけない（実際: ${value}）。NaN だと ">= 1" が常に false になり、`
    + 'ひのこが実際に進化していてもぴかりが一切出ない');

  const unlocks = pendingUnlocks(maxLevelEver(p), p.chars.map((c) => c.charId), value);
  assert.ok(
    unlocks.some((u) => u.kind === 'evolution' && u.choices.includes('pikari')),
    `非数値が混ざっていても、実際に実現している段階(1)ぶんはぴかりの解放に反映されるべき（unlocks: ${JSON.stringify(unlocks)})`,
  );
});
