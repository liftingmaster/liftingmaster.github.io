import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeCharEntry, maxLevelEver, playerView, stageOf, progressOf, displayName,
  addRecord, approvePending, rejectPending, switchChar, claimUnlock, setNickname,
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

  const expected = pendingUnlocks(maxLevelEver(p), p.chars.map((c) => c.charId));
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

// 「どの順番で承認しても合計EXPは同じ」が成り立つのは、上のテストが使っている
// もくも（ノーバウンドに特性が乗らない＝倍率が入力によって変わらない）だけ。
// 自己ベスト・レベル・連続日数を見る特性では、順番で合計が変わる。
// これは仕様であって不具合ではない（特性は「その記録の時点の状態」に対して効く）。
// 直そうとすると一括承認のあいだ特性の入力を凍結することになり、設計の変更になる。
// 実際の値をここに固定しておき、あとから発見されるのではなくコードに書いておく。
test('approvePending: ひのこ（自己ベストで倍率が変わる特性）では承認の順番で合計EXPが変わる', () => {
  const p = base('hinoko');
  p.settings.approvalEnabled = true;

  // 別々の日の記録2件。同じ日どうしなら日別ベストの差分方式で順不同になるが、
  // 日をまたぐと「自己ベスト更新かどうか」が承認順で変わる
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

  // 古い順: 10 が自己ベスト（10 × 3 × 1.5 = 45）、次に 12 も自己ベスト（12 × 3 × 1.5 = 54）
  assert.equal(runOrder(['q1', 'q2']), 99);
  // 新しい順: 12 が自己ベスト（54）、次の 10 はもう自己ベストではない（10 × 3 = 30）
  assert.equal(runOrder(['q2', 'q1']), 84);
  assert.notEqual(runOrder(['q1', 'q2']), runOrder(['q2', 'q1']));
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

test('switchChar: 育成キャラを切り替えても各キャラのEXPは保たれる', () => {
  let p = base();
  p = addRecord(p, { id: 'r1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  assert.equal(activeCharEntry(p).exp, 30);

  p = claimUnlock(p, 'hinoko', NOW);
  p = switchChar(p, 'hinoko');
  assert.equal(activeCharEntry(p).charId, 'hinoko');
  assert.equal(activeCharEntry(p).exp, 0, '新しいキャラはLv1から');

  p = switchChar(p, 'mokumo');
  assert.equal(activeCharEntry(p).exp, 30, '前のキャラのEXPは保たれる');
});

test('switchChar: 手持ちにないキャラには切り替えられない', () => {
  assert.throws(() => switchChar(base(), 'kagero'), /kagero/);
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
