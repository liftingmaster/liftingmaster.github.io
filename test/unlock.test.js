import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNLOCK_LEVELS, pendingUnlocks, nextUnlock } from '../js/core/unlock.js';

test('レベル由来の解放は Lv10・20・30・40・50', () => {
  assert.deepEqual(UNLOCK_LEVELS, [10, 20, 30, 40, 50]);
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

test('Lv30 でもくもが解放される（ぴかりは進化条件のまま）', () => {
  const p = pendingUnlocks(30, ['hinoko', 'shizuku', 'happa']);
  assert.deepEqual(p, [{ level: 30, choices: ['mokumo'] }]);
});

test('複数の解放を飛ばしていたらレベル順でまとめて返る', () => {
  const p = pendingUnlocks(40, ['hinoko']);
  assert.deepEqual(p.map((x) => x.level), [10, 20, 30, 40]);
  assert.deepEqual(p[2].choices, ['mokumo']);
  assert.deepEqual(p[3].choices, ['kirara']);
});

test('受け取り済みのキャラは選択肢から消える', () => {
  const p = pendingUnlocks(100, ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru', 'kagero']);
  assert.deepEqual(p, []);
});

test('nextUnlock は次のレベル由来の解放だけを予告する', () => {
  assert.deepEqual(nextUnlock(1), { level: 10, charId: null });
  assert.deepEqual(nextUnlock(25), { level: 30, charId: 'mokumo' });
  assert.deepEqual(nextUnlock(30), { level: 40, charId: 'kirara' });
  assert.deepEqual(nextUnlock(40), { level: 50, charId: 'kooru' });
});

test('nextUnlock は Lv50 到達後は null', () => {
  assert.equal(nextUnlock(50), null);
});

test('Lv10 の選択を確定してから再計算すると、Lv20 は残り1体の自動付与になる', () => {
  const before = pendingUnlocks(40, ['hinoko']);
  assert.deepEqual(before.map((x) => x.level), [10, 20, 30, 40]);
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

test('レベルが100でも第2進化が2匹いなければ、かげろは解放されない', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru'];
  const p = pendingUnlocks(99, owned);
  assert.deepEqual(p, []);
});

test('nextUnlock はちょうど節目のレベルでは次の節目を予告する', () => {
  assert.deepEqual(nextUnlock(30), { level: 40, charId: 'kirara' });
});

// =============================================================================
// 2026-07-30 安部さんの依頼: ぴかり(No.4・でんき)の解放条件を
// 「最高レベル30に到達」から「なかまの誰かが だい1しんか(stage:1)を達成した」に変える。
//
// pendingUnlocks の第3引数には、実現した進化段階と段階ごとのキャラ数を渡す。
// 数値だけを渡す旧形式も互換性のため使える。
//
// 進化由来の解放エントリの形は
//   { level: null, kind: 'evolution', stage: 1, count: 1, choices: ['pikari'] }
// に固定する（level 由来の { level, choices } と区別できるようにするため。
// party.js の renderUnlock が `Lv${unlock.level}` を組み立てるので、level が
// null なら kind で分岐できないと「Lvnull とうたつ！」になってしまう）。
//
// 判定は「1以上を実現したか」（evolvedStages に 1 だけでなく 2 が入っている
// ケース＝0→2の一気進化を取りこぼさないため）。
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

test('P1-b 進化実績を省略しても既定値0扱いで ぴかり は出ない', () => {
  const p = pendingUnlocks(100, ['hinoko', 'shizuku', 'happa']);
  assert.ok(!p.some((u) => u.choices.includes('pikari')));
});

test('P2 evolvedStages に 1 が入ったキャラが1体でもいれば ぴかり が pending に出る（進化由来entryの形も固定）', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa'], 1);
  assert.deepEqual(p, [{
    level: null, kind: 'evolution', stage: 1, count: 1, choices: ['pikari'],
  }]);
});

test('P3 evolvedStages に 2 だけが入っている（1を飛ばして2に到達した）キャラでも ぴかり が出る（「1以上を実現した」で判定）', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa', 'ganro'], 2);
  assert.deepEqual(
    p,
    [{
      level: null, kind: 'evolution', stage: 1, count: 1, choices: ['pikari'],
    }],
    'includes(1) の決め打ちだと 0→2 の一気進化を取りこぼす。>=1 で判定すること',
  );
});

test('P4 すでに ぴかり を持っているプレイヤーには出ない', () => {
  const p = pendingUnlocks(1, ['hinoko', 'shizuku', 'happa', 'pikari', 'ganro'], 2);
  assert.deepEqual(p, []);
});

test('P5 Lv30はもくもの解放レベルとして含まれる', () => {
  assert.ok(UNLOCK_LEVELS.includes(30));
});

test('P6 nextUnlock(25) は Lv30のもくもを予告する', () => {
  const n = nextUnlock(25);
  assert.deepEqual(n, { level: 30, charId: 'mokumo' });
});

test('P7 レベル由来と進化由来が同時に pending のとき、レベル由来が先に並ぶ', () => {
  // Lv40に到達済みだがhinokoしか持っていない（Lv10・Lv20の御三家選択がまだ残っている）
  // うえに、だい1しんかも実現済み(=1)にすると、レベル由来4件・進化由来1件が同時に出る
  const p = pendingUnlocks(40, ['hinoko'], 1);
  const withSortedChoices = p.map((u) => ({ ...u, choices: [...u.choices].sort() }));
  assert.deepEqual(withSortedChoices, [
    { level: 10, choices: ['happa', 'shizuku'] },
    { level: 20, choices: ['happa', 'shizuku'] },
    { level: 30, choices: ['mokumo'] },
    { level: 40, choices: ['kirara'] },
    {
      level: null, kind: 'evolution', stage: 1, count: 1, choices: ['pikari'],
    },
  ]);
});

test('P9 第2進化が1匹できたら がんろが解放される', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'kooru'];
  const progress = { maxStage: 2, countByStage: { 1: 1, 2: 1 } };
  const p = pendingUnlocks(50, owned, progress);
  assert.deepEqual(p, [{
    level: null, kind: 'evolution', stage: 2, count: 1, choices: ['ganro'],
  }]);
});

test('P10 第2進化が1匹ではかげろは出ず、2匹できたら解放される', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'ganro', 'kooru'];
  const one = pendingUnlocks(50, owned, { maxStage: 2, countByStage: { 1: 1, 2: 1 } });
  assert.ok(!one.some((u) => u.choices.includes('kagero')));

  const two = pendingUnlocks(50, owned, { maxStage: 2, countByStage: { 1: 2, 2: 2 } });
  assert.deepEqual(two, [{
    level: null, kind: 'evolution', stage: 2, count: 2, choices: ['kagero'],
  }]);
});

test('P11 がんろとかげろが同時に未受取でも、選択肢にまとめず1件ずつ返す', () => {
  const owned = ['hinoko', 'shizuku', 'happa', 'pikari', 'mokumo', 'kirara', 'kooru'];
  const p = pendingUnlocks(50, owned, { maxStage: 2, countByStage: { 1: 2, 2: 2 } });
  assert.deepEqual(p.map((u) => u.choices), [['ganro'], ['kagero']]);
});

test('P8 Lv10 の御三家選択の契約が壊れていない（進化由来を混ぜても既存の1件ずつ受け取る契約は保たれる）', () => {
  const p = pendingUnlocks(40, ['hinoko'], 0);
  const lv10 = p.find((u) => u.level === 10);
  const lv20 = p.find((u) => u.level === 20);
  assert.ok(lv10 && lv20, '前提: Lv10・Lv20 が両方pendingであること');
  assert.deepEqual(lv10.choices.sort(), ['happa', 'shizuku']);
  assert.deepEqual(lv20.choices.sort(), ['happa', 'shizuku'], 'Lv10の選択が確定するまでLv20はまだ2択に見える（既存仕様）');
});
