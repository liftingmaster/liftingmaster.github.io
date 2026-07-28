import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRecord, activeCharEntry } from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { dailyBest } from '../js/core/stats.js';

// 仕様: docs/superpowers/specs/2026-07-27-record-edit-and-dual-mode.md §4
//
// 機能Bは「core は変更しない」設計（§4.3）。view層が addRecord を
// ノー→ワンの順に固定して2回適用する前提で、その適用結果を core レベルで固定する。

const NOW = '2026-07-26T10:00:00.000Z';

const base = (starterId = 'mokumo') => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

test('両モード記録: addRecord を no→one の順に適用すると records に2件、date共通・mode違いで入る', () => {
  const p = base('mokumo');
  const afterNo = addRecord(p, { id: 'no1', count: 10, mode: 'no', date: '2026-07-26', now: NOW });
  const afterOne = addRecord(afterNo.player, { id: 'one1', count: 20, mode: 'one', date: '2026-07-26', now: NOW });
  const { player } = afterOne;
  assert.equal(player.records.length, 2);
  assert.equal(player.records[0].mode, 'no');
  assert.equal(player.records[1].mode, 'one');
  assert.equal(player.records[0].date, '2026-07-26');
  assert.equal(player.records[1].date, '2026-07-26');
});

test('両モード記録: 適用順を固定すると合計EXPが決定的になる（レベル依存特性で順序依存を実証）', () => {
  // はっぱ すくすく: Lv20以下で2倍。Lv20到達=4384EXP、Lv21到達=5043EXP
  // （gain.test.js で確認済みの既知の値）。
  //
  // もえあがる（自己ベスト依存）はモードごとに personalBest が分離されているため
  // ノー/ワンをまたいだ順序依存は起きない。レベル依存の特性（すくすく・きらめき）は
  // 「1回目の加算で相手の判定水準が変わる」ため、こちらで順序依存を実証する。
  const p = base('happa');
  p.chars[0].exp = 4384; // ちょうどLv20
  const countNo = 150;
  const countOne = 350;

  const noFirst = (() => {
    const r1 = addRecord(p, { id: 'a1', count: countNo, mode: 'no', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'a2', count: countOne, mode: 'one', date: '2026-07-26', now: NOW });
    return r1.result.exp + r2.result.exp;
  })();

  const oneFirst = (() => {
    const r1 = addRecord(p, { id: 'b1', count: countOne, mode: 'one', date: '2026-07-26', now: NOW });
    const r2 = addRecord(r1.player, { id: 'b2', count: countNo, mode: 'no', date: '2026-07-26', now: NOW });
    return r1.result.exp + r2.result.exp;
  })();

  // no→one: ノーは150×3×2=900（Lv20のすくすく2倍が効く）でLv21超に達し、
  //         ワンは350×1×1=350（すくすく不成立）→ 合計1250
  assert.equal(noFirst, 1250);
  // one→no: ワンは350×1×2=700（すくすく2倍）でLv21超に達し、
  //         ノーは150×3×1=450（すくすく不成立）→ 合計1150
  assert.equal(oneFirst, 1150);
  assert.notEqual(noFirst, oneFirst, '適用順によって合計が変わる。だからこそ view 側で順序を固定する必要がある');

  // view 層は常に no→one の順で適用する前提なので、この値（1250）を
  // 「両モード記録」の合計EXPの正本として固定する。
});

test('両モード記録: ノーバウンドとワンバウンドの日別ベストは互いに影響しない', () => {
  const p = base('mokumo');
  let cur = p;
  cur = addRecord(cur, { id: 'n1', count: 10, mode: 'no', date: '2026-07-26', now: NOW }).player;
  cur = addRecord(cur, { id: 'o1', count: 5, mode: 'one', date: '2026-07-26', now: NOW }).player;

  assert.equal(dailyBest(cur.records, '2026-07-26', 'no'), 10);
  assert.equal(dailyBest(cur.records, '2026-07-26', 'one'), 5);

  // 追加のノー（8、ベスト未満）はワンのベストに影響しない
  const afterNo2 = addRecord(cur, { id: 'n2', count: 8, mode: 'no', date: '2026-07-26', now: NOW });
  assert.equal(afterNo2.result.exp, 0, 'ノーのベスト未満なのでEXP0');
  assert.equal(dailyBest(afterNo2.player.records, '2026-07-26', 'one'), 5, 'ワンのベストは変わらない');

  // 追加のワン（6、ベスト超）はノーのベストに影響しない
  const afterOne2 = addRecord(cur, { id: 'o2', count: 6, mode: 'one', date: '2026-07-26', now: NOW });
  assert.equal(dailyBest(afterOne2.player.records, '2026-07-26', 'no'), 10, 'ノーのベストは変わらない');
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
  assert.equal(result.exp, 30);
});
