import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNLOCK_LEVELS, pendingUnlocks, nextUnlock } from '../js/core/unlock.js';

test('解放レベルは7段階（ぴかりはもうレベルの節目を持たない・Lv30は消えた）', () => {
  assert.deepEqual(UNLOCK_LEVELS, [10, 20, 40, 50, 65, 80, 100]);
});

test('Lv9 では解放なし', () => {
  assert.deepEqual(pendingUnlocks(9, ['hinoko']), []);
});

test('Lv10 で御三家の残り2体から1体を選ぶ', () => {
  const p = pendingUnlocks(10, ['hinoko']);
  assert.equal(p.length, 1);
  assert.equal(p[0].level, 10);
  assert.deepEqual(p[0].choices.sort(), ['happa', 'shizuku']);
});

test('Lv20 で御三家の最後の1体が自動で決まる', () => {
  const p = pendingUnlocks(20, ['hinoko', 'shizuku']);
  assert.equal(p.length, 1);
  assert.equal(p[0].level, 20);
  assert.deepEqual(p[0].choices, ['happa']);
});

// 2026-07-30: ぴかりの解放条件が「Lv30到達」から「だい1しんかの実現」に変わった。
// Lv30 はもう何もくれない節目（御三家3体・だい1しんか未実現ならここでは空振り）。
test('Lv30 はもう ぴかり をくれない（新ルールでは進化条件でしか解放されない）', () => {
  const p = pendingUnlocks(30, ['hinoko', 'shizuku', 'happa']);
  assert.deepEqual(p, []);
});

test('複数の解放を飛ばしていたらまとめて返る（古い順・Lv30はもう無い）', () => {
  const p = pendingUnlocks(40, ['hinoko']);
  assert.deepEqual(p.map((x) => x.level), [10, 20, 40]);
  assert.deepEqual(p[2].choices, ['mokumo']);
});

test('受け取り済みのキャラは選択肢から消える', () => {
  const p = pendingUnlocks(100, ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru', 'kagero']);
  assert.deepEqual(p, []);
});

test('Lv100 で かげろ が解放される', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru'];
  const p = pendingUnlocks(100, owned);
  assert.deepEqual(p.map((x) => x.level), [100]);
  assert.deepEqual(p[0].choices, ['kagero']);
});

test('nextUnlock は次の解放を予告する（Lv30・ぴかりはもう予告しない）', () => {
  assert.deepEqual(nextUnlock(1), { level: 10, charId: null });
  assert.deepEqual(nextUnlock(25), { level: 40, charId: 'mokumo' });
  assert.deepEqual(nextUnlock(80), { level: 100, charId: 'kagero' });
});

test('nextUnlock は Lv100 到達後は null', () => {
  assert.equal(nextUnlock(100), null);
});

test('Lv10 の選択を確定してから再計算すると、Lv20 は残り1体の自動付与になる', () => {
  const before = pendingUnlocks(40, ['hinoko']);
  assert.deepEqual(before.map((x) => x.level), [10, 20, 40]);
  assert.deepEqual(before[0].choices.sort(), ['happa', 'shizuku']);

  // Lv10 で shizuku を選んだことにして再計算する
  const after = pendingUnlocks(40, ['hinoko', 'shizuku']);
  assert.equal(after.find((x) => x.level === 10), undefined); // Lv10 は完了して消えている
  const lv20 = after.find((x) => x.level === 20);
  assert.deepEqual(lv20.choices, ['happa']);
});

test('御三家を2体持ったら Lv10 の節目は完了扱いで、二度と出ない', () => {
  const p = pendingUnlocks(10, ['hinoko', 'shizuku']);
  assert.deepEqual(p, []);
});

test('Lv99 では かげろ はまだ解放されない', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru'];
  const p = pendingUnlocks(99, owned);
  assert.deepEqual(p, []);
});

test('nextUnlock はちょうど節目のレベルでは次の節目を予告する', () => {
  // 旧テストは nextUnlock(30) を使っていたが、Lv30 はもう節目ではないので
  // Lv40（もくもの節目）に差し替える。「ちょうど節目にいる」ことの検証という
  // 意図は変えていない
  assert.deepEqual(nextUnlock(40), { level: 50, charId: 'kirara' });
});

// =============================================================================
// 2026-07-30 安部さんの依頼: ぴかり(No.4・でんき)の解放条件を
// 「最高レベル30に到達」から「なかまの誰かが だい1しんか(stage:1)を達成した」に変える。
//
// pendingUnlocks の署名を pendingUnlocks(maxLevelEver, ownedIds, maxEvolvedStageEver) に
// 拡張する前提でテストを書く（unlock.js は純粋関数に保つため、player 全体ではなく
// 「そのプレイヤーが実現した最高の進化段階（数値ひとつ）」だけを渡す）。
// 第3引数を省略したときの既定値は 0（＝誰も進化を実現していない）。
//
// 進化由来の解放エントリの形は
//   { level: null, kind: 'evolution', stage: 1, choices: ['pikari'] }
// に固定する（level 由来の { level, choices } と区別できるようにするため。
// party.js の renderUnlock が `Lv${unlock.level}` を組み立てるので、level が
// null なら kind で分岐できないと「Lvnull とうたつ！」になってしまう）。
//
// 判定は「1以上を実現したか」（evolvedStages に 1 だけでなく 2 が入っている
// ケース＝0→2の一気進化を取りこぼさないため）。
//
// これらのテストは、現時点（characters.js の pikari.unlockLevel がまだ 30 で
// unlock.js が maxEvolvedStageEver を受け取らない）では失敗する。実装がこの
// 契約に合わせて直ってから通ることを想定している。
// =============================================================================

test('P1 だい1しんか を1体も実現していないプレイヤーには、レベルがいくら高くても ぴかり が pending に出ない（Lv30・Lv50・Lv100）', () => {
  const owned = ['hinoko', 'shizuku', 'happa'];
  for (const lv of [30, 50, 100]) {
    const p = pendingUnlocks(lv, owned, 0);
    assert.ok(
      !p.some((u) => u.choices.includes('pikari')),
      `Lv${lv}: だい1しんかを誰も実現していないのに ぴかり が出てはいけない`,
    );
  }
});

test('P1-b maxEvolvedStageEver を省略しても既定値0扱いで ぴかり は出ない', () => {
  const p = pendingUnlocks(100, ['hinoko', 'shizuku', 'happa']);
  assert.ok(!p.some((u) => u.choices.includes('pikari')));
});

test('P2 evolvedStages に 1 が入ったキャラが1体でもいれば ぴかり が pending に出る（進化由来entryの形も固定）', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa'], 1);
  assert.deepEqual(p, [{
    level: null, kind: 'evolution', stage: 1, choices: ['pikari'],
  }]);
});

test('P3 evolvedStages に 2 だけが入っている（1を飛ばして2に到達した）キャラでも ぴかり が出る（「1以上を実現した」で判定）', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa'], 2);
  assert.deepEqual(
    p,
    [{
      level: null, kind: 'evolution', stage: 1, choices: ['pikari'],
    }],
    'includes(1) の決め打ちだと 0→2 の一気進化を取りこぼす。>=1 で判定すること',
  );
});

test('P4 すでに ぴかり を持っているプレイヤーには出ない', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa', 'pikari'], 2);
  assert.deepEqual(p, []);
});

test('P5 UNLOCK_LEVELS に 30 が含まれない', () => {
  assert.ok(!UNLOCK_LEVELS.includes(30));
});

test('P6 nextUnlock は Lv30 を予告しない（nextUnlock(25) が Lv30/ぴかりを返さない）', () => {
  const n = nextUnlock(25);
  assert.notEqual(n && n.level, 30);
  assert.notEqual(n && n.charId, 'pikari');
});

test('P7 レベル由来と進化由来が同時に pending のとき、レベル由来が先に並ぶ', () => {
  // Lv40に到達済みだがhinokoしか持っていない（Lv10・Lv20の御三家選択がまだ残っている）
  // うえに、だい1しんかも実現済み(=1)にすると、レベル由来3件・進化由来1件が同時に出る
  const p = pendingUnlocks(40, ['hinoko'], 1);
  const withSortedChoices = p.map((u) => ({ ...u, choices: [...u.choices].sort() }));
  assert.deepEqual(withSortedChoices, [
    { level: 10, choices: ['happa', 'shizuku'] },
    { level: 20, choices: ['happa', 'shizuku'] },
    { level: 40, choices: ['mokumo'] },
    {
      level: null, kind: 'evolution', stage: 1, choices: ['pikari'],
    },
  ]);
});

test('P8 Lv10 の御三家選択の契約が壊れていない（進化由来を混ぜても既存の1件ずつ受け取る契約は保たれる）', () => {
  const p = pendingUnlocks(40, ['hinoko'], 0);
  const lv10 = p.find((u) => u.level === 10);
  const lv20 = p.find((u) => u.level === 20);
  assert.ok(lv10 && lv20, '前提: Lv10・Lv20 が両方pendingであること');
  assert.deepEqual(lv10.choices.sort(), ['happa', 'shizuku']);
  assert.deepEqual(lv20.choices.sort(), ['happa', 'shizuku'], 'Lv10の選択が確定するまでLv20はまだ2択に見える（既存仕様）');
});
