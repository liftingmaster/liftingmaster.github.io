import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecord, editRecord, deleteRecord, switchChar, stageOf,
} from '../js/core/player.js';
import { createPlayer } from '../js/storage.js';
import { totalExpForLevel, levelFromExp } from '../js/core/exp.js';

// =============================================================================
// adversarial-reviewer が見つけた5件の欠陥への回帰網（2026-07-28 第2回改訂）。
// 実装は「対称なbefore/afterリプレイ方式」に組み替える予定（player.js 未着手）。
// このファイルは新方式の不変条件を実装に先立って固定するテスト。
// 現在の実装（非対称・時間文脈リーク・中間クランプあり）に対しては
// 以下のテストの多くが FAIL する想定（それが目的）。
//
// 数値はすべて js/core/gain.js の computeGain を直接呼んで手計算と一致することを
// 事前に確認済み（実装は変更していない。gain.js 自体は対象外）。
//
// 新方式の要点（このテストが前提にしている解釈）:
//   1. グループ = 同じ日・同じモードの全記録（新データも旧データも）
//   2. 持ち主 = 新データは record.charId、旧データは activeCharId
//   3/4. before = 元の回数でグループをcreatedAt順に空の状態からリプレイ
//        after  = 変更後の回数で同じくリプレイ
//   5. リプレイの文脈(acc)は「そのメンバーより後に作られた記録」を含めない
//      （グループ外の記録も、そのメンバーの createdAt 以前のものだけ）
//   6. 各キャラ: exp = max(0, exp + (afterの合計 - beforeの合計))。
//      クランプは最終結果に1回だけ
//   7. 各メンバーの grantedExp = after側の値。旧データが「対象記録R自身」なら
//      charIdを書いて格上げする。Rではない旧データの兄弟は、リプレイの文脈
//      （dailyBest等）には参加するが、それ自身の値はどのキャラの合計にも
//      加算されない（従来の「旧データはEXPを動かさない」を維持。
//      グループ再計算8のテストが示す既存の仕様）
// =============================================================================

const NOW = '2026-07-26T10:00:00.000Z';

const base = (starterId = 'hinoko') => {
  const p = createPlayer({ id: 'p1', name: 'たろう', starterId: 'hinoko', now: NOW });
  p.chars = [{ charId: starterId, nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }];
  p.activeCharId = starterId;
  return p;
};

const charExp = (player, charId) => player.chars.find((c) => c.charId === charId).exp;
const charEntry = (player, charId) => player.chars.find((c) => c.charId === charId);

// -----------------------------------------------------------------------------
// I1: 往復不変。count を X→Y→X と直すと、全キャラのexpが元に戻る
// （欠陥1・2・3をまとめて捕まえる。クランプに当たらない範囲で構成する）
// -----------------------------------------------------------------------------

test('I1-a 往復不変: 未来日の記録がある状態で、同日の記録を直して戻すとexpが戻る（欠陥1）', () => {
  const p = base('hinoko');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 10, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:01:00.000Z' }).player;
  // r3 は r1/r2 より「後に作られた」別日の記録。旧方式はこれを acc に混ぜて personalBest を汚染する
  cur = addRecord(cur, { id: 'r3', count: 30, mode: 'no', date: '2026-07-05', now: '2026-07-05T09:00:00.000Z' }).player;
  assert.equal(charExp(cur, 'hinoko'), 189, '前提: 45+9+135');

  const forward = editRecord(cur, { recordId: 'r2', count: 13, now: NOW });
  // before(r1=10,r2=12)=45+9=54 / after(r1=10,r2=13, acc=[r1]のみ。r3は含めない)=45+14=59 / diff+5
  assert.equal(charExp(forward.player, 'hinoko'), 194, '回数を増やしたのでEXPも増えるべき（旧方式は174=-15だった）');
  assert.equal(forward.player.records.find((r) => r.id === 'r1').grantedExp, 45, 'r1は無関係のまま');
  assert.equal(forward.player.records.find((r) => r.id === 'r2').grantedExp, 14);
  assert.equal(forward.player.records.find((r) => r.id === 'r3').grantedExp, 135, 'r3(未来日)は一切影響を受けない');

  const back = editRecord(forward.player, { recordId: 'r2', count: 12, now: NOW });
  assert.equal(charExp(back.player, 'hinoko'), 189, '元に戻る');
  assert.equal(back.player.records.find((r) => r.id === 'r2').grantedExp, 9);
  assert.equal(back.player.records.find((r) => r.id === 'r3').grantedExp, 135);
});

test('I1-b 往復不変: 旧データ自身を編集対象にしても、往復すればexpが戻る（欠陥3）', () => {
  // もくも: 旧r1(20,その日のベスト) + 新r2(12,grant0)。exp=60（60=r1recompute60+r2recompute0）
  const p = base('mokumo');
  p.chars[0].exp = 60;
  p.records = [
    { id: 'r1', date: '2026-07-20', mode: 'no', count: 20, createdAt: '2026-07-20T09:00:00.000Z' }, // 旧データ
    {
      id: 'r2', date: '2026-07-20', mode: 'no', count: 12, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 0,
    },
  ];

  const forward = editRecord(p, { recordId: 'r1', count: 25, now: NOW });
  // before=[20→60,12→0]=60 / after=[25→75,12→0]=75 / diff+15
  assert.equal(charExp(forward.player, 'mokumo'), 75, '正しくは3×25=75（旧方式は111だった）');
  assert.equal(forward.player.records.find((r) => r.id === 'r1').charId, 'mokumo', '旧データが格上げされる');
  assert.equal(forward.player.records.find((r) => r.id === 'r1').grantedExp, 75);

  const back = editRecord(forward.player, { recordId: 'r1', count: 20, now: NOW });
  assert.equal(charExp(back.player, 'mokumo'), 60, '元に戻る');
  assert.equal(back.player.records.find((r) => r.id === 'r1').grantedExp, 60);
});

test('I1-c 往復不変: 複数キャラ混在でも、片方のキャラの記録を直して戻すと両方のexpが戻る', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  const switched = switchChar(afterR1.player, 'mokumo');
  const afterR2 = addRecord(switched, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW });
  assert.equal(charExp(afterR2.player, 'hinoko'), 36);
  assert.equal(charExp(afterR2.player, 'mokumo'), 12);

  const forward = editRecord(afterR2.player, { recordId: 'r1', count: 10, now: NOW });
  assert.equal(charExp(forward.player, 'hinoko'), 45);
  assert.equal(charExp(forward.player, 'mokumo'), 6, 'もくもは直接編集していないのに動く');

  const back = editRecord(forward.player, { recordId: 'r1', count: 8, now: NOW });
  assert.equal(charExp(back.player, 'hinoko'), 36, 'ひのこが元に戻る');
  assert.equal(charExp(back.player, 'mokumo'), 12, 'もくもも元に戻る');
});

// -----------------------------------------------------------------------------
// I2: 保存則。クランプに当たらない限り、全キャラのexp増減の合計 = grantedExpの増減の合計
// -----------------------------------------------------------------------------

test('I2 保存則: クランプがないとき、全キャラのexp変化の合計はgrantedExpの変化の合計に等しい', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  const switched = switchChar(afterR1.player, 'mokumo');
  const before = addRecord(switched, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW }).player;

  const grantedBefore = new Map(before.records.map((r) => [r.id, r.grantedExp]));
  const expBefore = new Map(before.chars.map((c) => [c.charId, c.exp]));

  const { player: after } = editRecord(before, { recordId: 'r1', count: 10, now: NOW });

  const sumGrantedDelta = after.records
    .reduce((s, r) => s + ((r.grantedExp ?? 0) - (grantedBefore.get(r.id) ?? 0)), 0);
  const sumExpDelta = after.chars
    .reduce((s, c) => s + (c.exp - (expBefore.get(c.charId) ?? 0)), 0);

  assert.equal(sumGrantedDelta, 3, '45-36 + 6-12 = 9-6 = 3');
  assert.equal(sumExpDelta, 3, '保存則: 全キャラの増減合計はgrantedExpの増減合計と一致する');
});

// -----------------------------------------------------------------------------
// I3: 削除の単調性。削除で「削除対象と同じ記録の持ち主自身」のexpが増えることはない
// （欠陥3-Bを直接捕まえる。※ このスコープ限定。他キャラの整理棄却で他キャラのexpが
//   増えることは、I9で示すとおり別問題として正当にあり得る）
// -----------------------------------------------------------------------------

test('I3-a 削除の単調性: 兄弟より低い旧データを削除しても、キャラのexpは増えない（変化なし）', () => {
  // もくも: 旧8かい(先着) + 新20かい(grant36)。exp=60(=8recompute24+20recompute36)
  const p = base('mokumo');
  p.chars[0].exp = 60;
  p.records = [
    { id: 'old1', date: '2026-07-20', mode: 'no', count: 8, createdAt: '2026-07-20T09:00:00.000Z' },
    {
      id: 'new1', date: '2026-07-20', mode: 'no', count: 20, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 36,
    },
  ];
  const { player, result } = deleteRecord(p, { recordId: 'old1', now: NOW });
  assert.equal(charExp(player, 'mokumo'), 60, '20かいが単独でも同じ日別ベストを出すので変化なし（旧方式は+24の水増しだった）');
  assert.equal(result.expDelta, 0);
});

test('I3-b 削除の単調性: 兄弟より高い旧データを削除すると、キャラのexpは減る（増えることはない）', () => {
  // もくも: 旧20かい(先着,その日のベスト) + 新12かい(grant0)。exp=60
  const p = base('mokumo');
  p.chars[0].exp = 60;
  p.records = [
    { id: 'old1', date: '2026-07-20', mode: 'no', count: 20, createdAt: '2026-07-20T09:00:00.000Z' },
    {
      id: 'new1', date: '2026-07-20', mode: 'no', count: 12, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 0,
    },
  ];
  const { player, result } = deleteRecord(p, { recordId: 'old1', now: NOW });
  // 残る12かい単独: 12×3=36
  assert.equal(charExp(player, 'mokumo'), 36, '減っている（増えていない）');
  assert.ok(result.expDelta <= 0, '削除で増えてはいけない');
  assert.equal(result.expDelta, -24);
});

test('I3-c 削除の単調性: 大きい数値でも同じ性質が成り立つ（欠陥3-B「旧600/新700」の健全な再現）', () => {
  // もくも: 旧600かい(先着,ベスト) + 新700かい(grant300)。exp=2100(=600recompute1800+700recompute300)
  const p = base('mokumo');
  p.chars[0].exp = 2100;
  p.records = [
    { id: 'old1', date: '2026-07-20', mode: 'no', count: 600, createdAt: '2026-07-20T09:00:00.000Z' },
    {
      id: 'new1', date: '2026-07-20', mode: 'no', count: 700, createdAt: '2026-07-20T10:00:00.000Z',
      charId: 'mokumo', grantedExp: 300,
    },
  ];
  const { player, result } = deleteRecord(p, { recordId: 'old1', now: NOW });
  // 700が単独でも同じ日別ベストなので変化なし。旧方式は「300→2100」という+1800の水増しだった
  assert.equal(charExp(player, 'mokumo'), 2100, '大きい数値でも増えない（水増しが起きない）');
  assert.equal(result.expDelta, 0);
});

// -----------------------------------------------------------------------------
// I4: 時間文脈。そのメンバーより後に作られた記録は personalBest・currentStreak に
// 影響しない（欠陥1の2例をそのままテストにする）
// -----------------------------------------------------------------------------

test('I4-a 時間文脈: ひのこ 07-05の未来のノー30かいがpersonalBestを汚染しない（もえあがるが剥がれない）', () => {
  const p = base('hinoko');
  let cur = p;
  cur = addRecord(cur, { id: 'r1', count: 10, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'r2', count: 12, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:01:00.000Z' }).player;
  cur = addRecord(cur, { id: 'r3', count: 30, mode: 'no', date: '2026-07-05', now: '2026-07-05T09:00:00.000Z' }).player;
  assert.equal(charExp(cur, 'hinoko'), 189);

  const { player, result } = editRecord(cur, { recordId: 'r2', count: 13, now: NOW });
  assert.equal(charExp(player, 'hinoko'), 194, '回数を増やしたのにEXPが減ってはいけない（欠陥1: 旧方式は174=-15）');
  assert.equal(result.expDelta, 5);
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 14, 'もえあがる(×1.5)が正しく効いた値（13-10=3を4.5倍→13.5→14）');
});

test('I4-b 時間文脈: しずく 07-10〜12の未来の連続がしみこむを07-01の記録に後付けしない', () => {
  const p = base('shizuku');
  let cur = p;
  cur = addRecord(cur, { id: 'a', count: 10, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'b', count: 12, mode: 'no', date: '2026-07-01', now: '2026-07-01T09:01:00.000Z' }).player;
  cur = addRecord(cur, { id: 'c', count: 5, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'd', count: 5, mode: 'no', date: '2026-07-11', now: '2026-07-11T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'e', count: 5, mode: 'no', date: '2026-07-12', now: '2026-07-12T09:00:00.000Z' }).player;
  assert.equal(charExp(cur, 'shizuku'), 84, '前提: 30+6+15+15+18');

  const { player, result } = editRecord(cur, { recordId: 'b', count: 13, now: NOW });
  // before(a=10,b=12)=30+6=36 / after(a=10,b=13, acc=[a]のみ)=30+9=39 / diff+3
  assert.equal(charExp(player, 'shizuku'), 87, '07-10〜12の連続を07-01の記録に後付けしてはいけない（欠陥1: 旧方式は95）');
  assert.equal(result.expDelta, 3);
  assert.equal(player.records.find((r) => r.id === 'b').grantedExp, 9, 'しみこむ(×1.2)が誤って乗ってはいけない（乗ると3×3.6=10.8→11になる）');
  assert.equal(player.records.find((r) => r.id === 'c').grantedExp, 15, '未来の記録自身も変わらない');
  assert.equal(player.records.find((r) => r.id === 'd').grantedExp, 15);
  assert.equal(player.records.find((r) => r.id === 'e').grantedExp, 18);
});

// -----------------------------------------------------------------------------
// I5: ネットクランプ。引ききれない負債を抱えたキャラに再付与しても、
// 無からEXPが生まれない（欠陥2の再現手順をそのままテストにする）
// -----------------------------------------------------------------------------

test('I5 ネットクランプ: 旧データを2件消してクランプに当たった後、無関係な兄弟の微調整で無からEXPが生まれない', () => {
  const p = base('hinoko');
  // o1,o2 は旧データ（先に起きた記録という設定）。n1,n2 は新データ
  p.records = [
    { id: 'o1', date: '2026-07-01', mode: 'no', count: 60, createdAt: '2026-07-01T09:00:00.000Z' },
    { id: 'o2', date: '2026-07-02', mode: 'no', count: 70, createdAt: '2026-07-02T09:00:00.000Z' },
  ];
  let cur = addRecord(p, { id: 'n1', count: 50, mode: 'no', date: '2026-07-20', now: '2026-07-20T09:00:00.000Z' }).player;
  cur = addRecord(cur, { id: 'n2', count: 55, mode: 'no', date: '2026-07-20', now: '2026-07-20T10:00:00.000Z' }).player;
  // n1: personalBest([o1,o2])=70, 50<70なので通常倍率 → 50×3=150
  // n2: dailyBest=50, delta=5, personalBest=70, 55<70 → 5×3=15
  assert.equal(charExp(cur, 'hinoko'), 165, '旧データは何も付与しない前提（150+15）');

  const afterDeleteO1 = deleteRecord(cur, { recordId: 'o1', now: NOW });
  // o1単独を空の状態から引き直す: 60×3×1.5(自己ベスト更新)=270。 165-270 = -105 → クランプ0
  assert.equal(charExp(afterDeleteO1.player, 'hinoko'), 0, 'o1削除だけで既にクランプに当たる');

  const afterDeleteO2 = deleteRecord(afterDeleteO1.player, { recordId: 'o2', now: NOW });
  // o2単独(o1は既に消えている)を引き直す: 70×3×1.5=315。 0-315 → さらにクランプ0
  assert.equal(charExp(afterDeleteO2.player, 'hinoko'), 0, 'まだクランプの底');

  // ここで n2 を 55→56 に「ちょっと」直す。o1,o2 が消えたことで n1 自身の
  // personalBest文脈も変わり(0になる)、n1のグループ内再計算値も225に上がるが、
  // n1は編集対象ではないので before/after 両方に同額225が乗って相殺される。
  // 実際に動くのは n2 の delta のみ:
  //   before: n1(50,acc=[])=225 / n2(55,acc=[n1])=23 → 248
  //   after : n1(50,acc=[])=225 / n2(56,acc=[n1])=27 → 252
  //   diff = +4
  const { player, result } = editRecord(afterDeleteO2.player, { recordId: 'n2', count: 56, now: NOW });
  assert.equal(charExp(player, 'hinoko'), 4, 'クランプで失った負債(-105,-315)が復活して無からEXPが生まれてはいけない（欠陥2: 旧方式は+252規模の水増し）');
  assert.equal(result.expDelta, 4);
});

// -----------------------------------------------------------------------------
// I6〜I9: 兄弟キャラの報告（欠陥4・5）。result.charChanges の新形状
// -----------------------------------------------------------------------------

test('I6 charChanges: グループ再計算で動いた全キャラが入り、動いていないキャラは入らない', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  p.chars.push({ charId: 'happa', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] }); // 完全に無関係
  const afterR1 = addRecord(p, { id: 'r1', count: 8, mode: 'no', date: '2026-07-20', now: NOW });
  const switched = switchChar(afterR1.player, 'mokumo');
  const afterR2 = addRecord(switched, { id: 'r2', count: 12, mode: 'no', date: '2026-07-20', now: NOW });

  const { result } = editRecord(afterR2.player, { recordId: 'r1', count: 10, now: NOW });
  assert.ok(Array.isArray(result.charChanges), 'result.charChanges が配列で返る');

  const byId = new Map(result.charChanges.map((c) => [c.charId, c]));
  assert.equal(byId.size, 2, 'happa（無関係）は入らない');
  assert.ok(byId.has('hinoko'));
  assert.ok(byId.has('mokumo'));
  assert.equal(byId.get('hinoko').expDelta, 9);
  assert.equal(byId.get('mokumo').expDelta, -6);
  assert.ok(!byId.has('happa'));
});

test('I7 charChanges: 兄弟キャラのレベルが下がったとき levelBefore > levelAfter が読み取れる（欠陥4-A）', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });
  const afterR1 = addRecord(p, { id: 'r1', count: 30, mode: 'no', date: '2026-07-20', now: NOW });
  const switched = switchChar(afterR1.player, 'mokumo');
  const afterR2 = addRecord(switched, { id: 'r2', count: 200, mode: 'no', date: '2026-07-20', now: NOW });
  assert.equal(charExp(afterR2.player, 'hinoko'), 135);
  assert.equal(charExp(afterR2.player, 'mokumo'), 510);
  assert.equal(levelFromExp(510).level, 9, '前提: もくもはLv9');

  const { player, result } = editRecord(afterR2.player, { recordId: 'r1', count: 250, now: NOW });
  assert.equal(charExp(player, 'hinoko'), 1125);
  assert.equal(charExp(player, 'mokumo'), 0, 'もくもは510→0に落ちる（欠陥4-A）');
  assert.equal(levelFromExp(0).level, 1);

  const mokumoChange = result.charChanges.find((c) => c.charId === 'mokumo');
  assert.ok(mokumoChange, 'もくもがcharChangesに入っている');
  assert.equal(mokumoChange.expDelta, -510);
  assert.equal(mokumoChange.levelBefore, 9);
  assert.equal(mokumoChange.levelAfter, 1);
  assert.ok(mokumoChange.levelBefore > mokumoChange.levelAfter, 'これがないとlevelDropNoticeが出せない（欠陥4-A本体）');

  const hinokoChange = result.charChanges.find((c) => c.charId === 'hinoko');
  assert.ok(hinokoChange);
  assert.equal(hinokoChange.expDelta, 990);
});

test('I8 charChanges: 兄弟キャラが編集をきっかけに進化条件を満たすと evolvedTo が入り evolvedStages に追記される（欠陥4派生）', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'mokumo', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  // もくも 第1進化: レベル15 / ワン30 / 連続5にち（characters.js）
  // ワン30は r2 の count そのもので満たす。連続5にちは filler で用意する
  for (let d = 6; d <= 9; d += 1) {
    p.records.push({
      id: `filler${d}`, date: `2026-07-0${d}`, mode: 'one', count: 1, createdAt: `2026-07-0${d}T09:00:00.000Z`,
    });
  }
  // もくものexpをLv15にわずかに届かない水準にしておく（レベル条件だけがブロッカー）
  charEntry(p, 'mokumo').exp = totalExpForLevel(15) - 10;
  assert.equal(levelFromExp(charExp(p, 'mokumo')).level, 14, '前提: もくもはまだLv14');

  let cur = addRecord(p, { id: 'r1', count: 100, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z' }).player;
  const switched = switchChar(cur, 'mokumo');
  cur = addRecord(switched, { id: 'r2', count: 30, mode: 'one', date: '2026-07-10', now: '2026-07-10T09:01:00.000Z' }).player;
  assert.equal(stageOf(cur, 'mokumo'), 0, '前提: まだ進化していない（レベル条件だけが足りない）');

  // r1(ひのこ)を100→5に減らす。もくものr2は「その日のベスト」が5に下がるので
  // delta=25まで解放され、fuwafuwa(×2)で+50。もくもがLv15に届いて進化する
  const { player, result } = editRecord(cur, { recordId: 'r1', count: 5, now: '2026-07-10T09:02:00.000Z' });
  assert.equal(charExp(player, 'mokumo'), (totalExpForLevel(15) - 10) + 50);
  assert.equal(levelFromExp(charExp(player, 'mokumo')).level, 15);
  assert.equal(stageOf(player, 'mokumo'), 1, '進化条件を満たした');

  const mokumoChange = result.charChanges.find((c) => c.charId === 'mokumo');
  assert.ok(mokumoChange, 'もくもがcharChangesに入っている');
  assert.equal(mokumoChange.expDelta, 50);
  assert.equal(mokumoChange.stageBefore, 0);
  assert.equal(mokumoChange.evolvedTo, 1, '欠陥4-Bと同種: 兄弟の進化がcharChangesから読み取れないと演出を出せない');
  assert.deepEqual(charEntry(player, 'mokumo').evolvedStages, [1], 'evolvedStagesにも追記されている');
});

test('I9 charChanges: 削除で兄弟キャラが進化しても evolvedTo が入る（欠陥5: viewが拾えるようにするため）', () => {
  const p = base('hinoko');
  p.chars.push({ charId: 'shizuku', nickname: null, exp: 0, unlockedAt: NOW, evolvedStages: [] });

  // しずく 第1進化: レベル12 / ノー10 / 連続10にち（characters.js）
  for (let d = 1; d <= 9; d += 1) {
    p.records.push({
      id: `filler${d}`, date: `2026-07-0${d}`, mode: 'one', count: 1, createdAt: `2026-07-0${d}T09:00:00.000Z`,
    });
  }
  let cur = addRecord(p, { id: 'r1', count: 400, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:00:00.000Z' }).player;
  const switched = switchChar(cur, 'shizuku');
  cur = addRecord(switched, { id: 'r2', count: 300, mode: 'no', date: '2026-07-10', now: '2026-07-10T09:01:00.000Z' }).player;
  assert.equal(charExp(cur, 'hinoko'), 1800);
  assert.equal(charExp(cur, 'shizuku'), 0, '前提: ひのこの400かいに阻まれて0のまま');
  assert.equal(stageOf(cur, 'shizuku'), 0);

  const { player, result } = deleteRecord(cur, { recordId: 'r1', now: NOW });
  assert.equal(charExp(player, 'hinoko'), 0);
  assert.equal(charExp(player, 'shizuku'), 1080, '欠陥4-B: しずくが0→1080に伸びる');
  assert.equal(levelFromExp(1080).level, 12);
  assert.equal(stageOf(player, 'shizuku'), 1);

  assert.equal(result.charId, 'hinoko', 'トップレベルの result は削除対象(ひのこ)のもの');
  assert.equal(result.evolvedTo, null, 'ひのこ自身は進化しない');

  const shizukuChange = result.charChanges.find((c) => c.charId === 'shizuku');
  assert.ok(shizukuChange, '削除でもしずくがcharChangesに入っている（欠陥5の核心）');
  assert.equal(shizukuChange.expDelta, 1080);
  assert.equal(shizukuChange.evolvedTo, 1);
  assert.equal(shizukuChange.stageBefore, 0);
  assert.deepEqual(charEntry(player, 'shizuku').evolvedStages, [1]);
});

// =============================================================================
// L1〜L5: baseExp が「記録した当時のレベル水準」ではなく「今のレベル」になっている欠陥
// （js/core/player.js:294-300）への回帰網。2026-07-28 第3回レビューで検出。
//
// 直し方（実装がこの前提で動くことを期待するテスト。実装は変更していない）:
//   baseExp[c] = max(0, c.exp − そのキャラの「全記録」のgrantedExp合計)
//     （従来は「編集対象のグループ内メンバーのgrantedExp合計」だけを引いていた。
//      グループ外・後から作られた記録のgrantedExpを引かないので、baseExpが
//      ほぼ「今のexp」に近くなり、レベル依存特性（すくすく・きらめき）の判定が
//      「記録した当時のレベル」ではなく「今のレベル」でされてしまう）
//   その後、並び順に全記録を走査し、非メンバーは保存済みgrantedExpを、
//   メンバーはリプレイで計算した値をrunningへ加算していく。
//
// 数値はすべて js/core/exp.js の levelFromExp／js/core/gain.js の computeGain
// （どちらもバグの対象外・不変更）を使い、上の直し方をそのままコードにした
// 別実装の「電卓」で導出し、Node上の算術で確認済み（scratchpad/refCalc.mjs、
// このファイルにはコミットしていない）。js/core/player.js は一切呼ばずに導出した後、
// 実際に js/core/player.js の deleteRecord/editRecord を呼んで「現状は違う値になる」
// ことも別途確認済み（下記コメントに実測値を明記）。
// =============================================================================

test('L1 レベル依存特性: はっぱ Lv1のときの記録を、レベルが上がってから削除すると expDelta は渡した grantedExp と一致する', () => {
  const p = base('happa');
  // r1: 7/1にLv1で4かい（ノー）。sukusuku(×2)で 4×3×2=24
  // r2: 8/1に2000かい（ノー）。r1処理直後(charExp=24,Lv1)なのでsukusukuが乗り 2000×3×2=12000
  // 合計 24+12000=12024（Lv28）。r1が「渡した」のは24
  p.chars[0].exp = 24 + 12000;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 4, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 24,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 2000, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 12000,
    },
  ];
  assert.equal(levelFromExp(charExp(p, 'happa')).level, 28, '前提: r2の後はLv28');

  const { player, result } = deleteRecord(p, { recordId: 'r1', now: NOW });
  // 直し方どおりの baseExp = max(0, 12024-(24+12000)) = 0。
  // before: r1(count=4,charExp=0,Lv1)=24 → running=24、r2は非メンバーなので
  //         保存済みgrantedExp(12000)を加算 → before合計=12024
  // after : r1抜き。r2のみ非メンバーとして12000を加算 → after合計=12000
  // diff = 12000-12024 = -24 → expDelta=-24（渡した24とちょうど一致）
  //
  // 現状（欠陥あり）の実測: baseExp = 12024-24(グループ内=r1自身のみ)=12000（Lv28相当）。
  // r1をLv28水準で計算し直すとsukusukuが外れ 4×3=12 になり、expDelta=-12 になる
  // （渡した24の半分しか引き戻せない＝+12の水増しが残る。レビュアーの再現ケースそのもの）
  assert.equal(result.expDelta, -24, '渡した分(24)とちょうど一致する（現状は-12になる想定）');
  assert.equal(charExp(player, 'happa'), 12000);
});

test('L2 レベル依存特性: はっぱ Lv1のときの記録を訂正するとき、訂正するタイミング（今のレベル）で結果が変わらない', () => {
  // 当日訂正（r2はまだ存在しない）
  const immediate = base('happa');
  immediate.chars[0].exp = 24;
  immediate.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 4, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 24,
    },
  ];
  const sameDay = editRecord(immediate, { recordId: 'r1', count: 400, now: NOW });
  // baseExp = max(0, 24-24) = 0。before(count=4,charExp=0)=24 / after(count=400,charExp=0)
  // = 400×3×2(すくすく,Lv1)=2400 → diff=+2376
  assert.equal(sameDay.result.expDelta, 2376);
  assert.equal(sameDay.player.records.find((r) => r.id === 'r1').grantedExp, 2400);

  // 70日後に訂正（r2で先にLv28まで育っている。r1自身の記録内容は同じ）
  const later = base('happa');
  later.chars[0].exp = 24 + 12000; // 前提はL1と同じ組み立て
  later.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 4, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 24,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 2000, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 12000,
    },
  ];
  assert.equal(levelFromExp(charExp(later, 'happa')).level, 28, '前提: 訂正前はLv28');
  const laterEdit = editRecord(later, { recordId: 'r1', count: 400, now: NOW });
  // baseExp = max(0, 12024-(24+12000)) = 0。r1は7/1で最も早い記録なので
  // running(r1直前)=0。before(count=4,charExp=0)=24 / after(count=400,charExp=0)=2400
  // → diff=+2376。r2(非メンバー)はどちらの側にも同額12000を加算するだけなので相殺される
  //
  // 現状（欠陥あり）の実測: expDelta=1188（同日訂正の半分）。r1.grantedExp=1200。
  // baseExpが12000(=グループ内=r1自身のみを引いた値)まで上がってしまい、
  // r1をLv28水準で計算し直すとsukusukuが外れるため。「訂正したタイミングだけで
  // 結果が変わる」というレビュアーの指摘そのもの
  assert.equal(laterEdit.result.expDelta, 2376, '訂正のタイミングで結果が変わってはいけない（現状は1188になる想定）');
  assert.equal(laterEdit.player.records.find((r) => r.id === 'r1').grantedExp, 2400);
  assert.equal(sameDay.result.expDelta, laterEdit.result.expDelta, '当日訂正と70日後訂正で同じdiffになる');
});

test('L3 レベル依存特性: きらら Lv50以上のときに、Lv1時代の記録を削除すると expDelta は渡した grantedExp と一致する', () => {
  const p = base('kirara');
  // r1: 7/1にLv1で300かい（ノー）。きらめきはLv50以上でしか乗らないので通常倍率 300×3=900
  // r2: 8/1に54100かい（ノー）。r1直後(charExp=900,Lv11)なのでまだきらめきは乗らない
  //     54100×3=162300。合計 900+162300=163200（Lv71）。r1が「渡した」のは900
  p.chars[0].exp = 900 + 162300;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 300, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'kirara', grantedExp: 900,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 54100, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'kirara', grantedExp: 162300,
    },
  ];
  assert.equal(levelFromExp(charExp(p, 'kirara')).level, 71, '前提: r2の後はLv71');

  const { player, result } = deleteRecord(p, { recordId: 'r1', now: NOW });
  // baseExp = max(0, 163200-(900+162300)) = 0。before合計=163200 / after合計(r2のみ)=162300
  // → diff=-900（渡した900とちょうど一致）
  //
  // 現状（欠陥あり）の実測: expDelta=-1350（渡していない450EXPを余計に引く。
  // レビュアーの再現ケースそのもの）
  assert.equal(result.expDelta, -900, '渡した分(900)とちょうど一致する（現状は-1350になる想定）');
  assert.equal(charExp(player, 'kirara'), 162300);
});

test('L4 レベル依存特性: はっぱ、同じグループ内でリプレイ中にLv20をまたぐと、2件目の判定が切り替わる', () => {
  const p = base('happa');
  // r1: 1かい(誤入力想定) → grant 1×3×2(すくすく,Lv1)=6
  // r2: 1200かい → dailyBest=1,delta=1199だが素朴化のため count自体をdailyBest比較に使う設計。
  //     ここではr2のcontextはr1のみ: delta=1200-1=1199...ではなく実際は
  //     computeGain(records=[r1(1)],record={count:1200},charExp=6)で確認した実測値を使う
  p.chars[0].exp = 6 + 7194; // r1(6) + r2(7194, charExp=6のときの実測)
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 1, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 6,
    },
    {
      id: 'r2', date: '2026-07-01', mode: 'no', count: 1200, createdAt: '2026-07-01T09:01:00.000Z',
      charId: 'happa', grantedExp: 7194,
    },
  ];
  assert.equal(charExp(p, 'happa'), 7200);

  const { player, result } = editRecord(p, { recordId: 'r1', count: 1000, now: NOW });
  // グループ[r1,r2]を空(baseExp=0)から引き直す:
  //   r1: charExp=0(Lv1) → delta=1000-0=1000 → 1000×3×2(すくすく)=6000。running=6000
  //   r2: charExp=6000。levelFromExp(6000)=Lv22(>20)なのでsukusukuが外れる
  //       → delta=1200-1000(dailyBest)=200 → 200×3×1=600
  // グループ合計=6600。before合計=7200(=6+7194)。diff=-600
  assert.equal(player.records.find((r) => r.id === 'r1').grantedExp, 6000);
  assert.equal(player.records.find((r) => r.id === 'r2').grantedExp, 600, '1件目でLv20を超えたので2件目はすくすくが外れる');
  assert.equal(charExp(player, 'happa'), 6600);
  assert.equal(result.expDelta, -600);
});

// L5: 往復不変。L1〜L4のいずれも、直して戻す／消して戻す方向の操作を2回連続で行うと
// 全て元のexpに戻る。ただし deleteRecord には「戻す」ための公開APIがないため、
// L1・L3(削除)は「削除」ではなく「同じ性質を持つ大きな減算→復元」のeditRecord往復に
// 置き換えて検証する（L2・L4はそのままeditRecordの往復）。
//
// 【注意・タスク文の指摘の実測結果】 「全キャラのexpの合計」だけを見る往復不変は、
// たしかに「戻す側のbeforeも同じ再計算値になるので必ず元に戻ってしまう」
// （タスク文の指摘のとおり。L5-1〜L5-3のいずれも、活性キャラのexp総量そのものは
// 現状の実装（欠陥あり）でも元に戻ることを実測済み: 12024/12024/163200）。
// しかし「編集対象の記録r1自身のgrantedExpが元の値に戻るか」まで見ると、
// 現状の実装ではr2(別グループ・後から作られた記録)が絡むL5-1〜L5-3で
// **戻らない**（実測: 24→12、24→12、900→1350）。r1とr2が同じグループの中に
// 収まるL5-4だけは、そもそもグループ外への漏れがないので現状でも一致する。
// つまりL5は「exp合計」だけでは欠陥を検出できないが、「編集対象記録自身の
// grantedExpの往復」まで固定すればL5単独でも欠陥を検出できる
// （このファイルでは両方を書き、検出力の違いをコメントで明示する）
test('L5-1 往復不変: はっぱ Lv1記録を Lv28まで育った後に 4→40→4 と直しても元のexpに戻る', () => {
  const p = base('happa');
  p.chars[0].exp = 24 + 12000;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 4, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 24,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 2000, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 12000,
    },
  ];
  const forward = editRecord(p, { recordId: 'r1', count: 40, now: NOW });
  const back = editRecord(forward.player, { recordId: 'r1', count: 4, now: NOW });
  assert.equal(charExp(back.player, 'happa'), 12024);
  assert.equal(back.player.records.find((r) => r.id === 'r1').grantedExp, 24);
});

test('L5-2 往復不変: はっぱ Lv1記録を Lv28まで育った後に 4→400→4 と直しても元のexpに戻る', () => {
  const p = base('happa');
  p.chars[0].exp = 24 + 12000;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 4, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 24,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 2000, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 12000,
    },
  ];
  const forward = editRecord(p, { recordId: 'r1', count: 400, now: NOW });
  assert.equal(charExp(forward.player, 'happa'), 14400);
  const back = editRecord(forward.player, { recordId: 'r1', count: 4, now: NOW });
  assert.equal(charExp(back.player, 'happa'), 12024);
  assert.equal(back.player.records.find((r) => r.id === 'r1').grantedExp, 24);
});

test('L5-3 往復不変: きらら Lv1記録を Lv71まで育った後に 300→3000→300 と直しても元のexpに戻る', () => {
  const p = base('kirara');
  p.chars[0].exp = 900 + 162300;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 300, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'kirara', grantedExp: 900,
    },
    {
      id: 'r2', date: '2026-08-01', mode: 'no', count: 54100, createdAt: '2026-08-01T09:00:00.000Z',
      charId: 'kirara', grantedExp: 162300,
    },
  ];
  const forward = editRecord(p, { recordId: 'r1', count: 3000, now: NOW });
  const back = editRecord(forward.player, { recordId: 'r1', count: 300, now: NOW });
  assert.equal(charExp(back.player, 'kirara'), 163200);
  assert.equal(back.player.records.find((r) => r.id === 'r1').grantedExp, 900);
});

test('L5-4 往復不変: はっぱ、Lv20境界をまたぐ2件組でも 1→1000→1 と直しても元のexpに戻る', () => {
  const p = base('happa');
  p.chars[0].exp = 7200;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 1, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'happa', grantedExp: 6,
    },
    {
      id: 'r2', date: '2026-07-01', mode: 'no', count: 1200, createdAt: '2026-07-01T09:01:00.000Z',
      charId: 'happa', grantedExp: 7194,
    },
  ];
  const forward = editRecord(p, { recordId: 'r1', count: 1000, now: NOW });
  const back = editRecord(forward.player, { recordId: 'r1', count: 1, now: NOW });
  assert.equal(charExp(back.player, 'happa'), 7200);
  assert.equal(back.player.records.find((r) => r.id === 'r1').grantedExp, 6);
  assert.equal(back.player.records.find((r) => r.id === 'r2').grantedExp, 7194);
});

// =============================================================================
// S1〜S4: 連続編集（別グループの残留）。今回のL1〜L5の修正対象とは別の、既存の
// 割り切りの帰結を「仕様として固定」するテスト（今回直す対象ではない）。
//
// ひのこの特性「もえあがる」はレベルに依存しない（自己ベスト更新かどうかだけで
// 判定する）ため、baseExpの取り方（今回のL1〜L5の修正）はこれらの数値に一切
// 影響しない。実際、下の数値はすべて現状の js/core/player.js（未修正）と、
// 「直し方」を反映した別実装の電卓（scratchpad/refCalc.mjs）の両方で同一の値になる
// ことを確認済み。つまりS1〜S4はA(L1〜L5)の修正前後で値が変わらない
// （このファイルの巻頭コメントで要求されていた「Aの修正で値が変わる可能性がある」
// 確認の結果、変わらないと判断した）。
//
// 割り切りの内容: editRecord/deleteRecordは「編集対象の日・モードのグループ」だけを
// 空の状態から引き直す。別の日のグループのgrantedExpは、そのグループ自体を
// 編集しない限り古い値のまま残る。もえあがる(自己ベスト更新×1.5)はpersonalBestが
// 全期間で決まるため、別の日の記録を直すと理屈上は他の日の判定も変わりうるが、
// 実装はそこまで追跡しない。これは js/core/player.js の設計上の既知の制約であり、
// 今回の欠陥（L1〜L5）とは無関係
// =============================================================================

test('S1 連続編集（既知の残留・固定）: ひのこ 7/1を5→20に直してから7/5を消すと exp=102 になる', () => {
  const p = base('hinoko');
  // 7/1:5かい(自己ベスト更新,grant23=5×3×1.5) 7/5:8かい(自己ベスト更新,grant36=8×3×1.5)
  p.chars[0].exp = 59;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 5, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 23,
    },
    {
      id: 'r2', date: '2026-07-05', mode: 'no', count: 8, createdAt: '2026-07-05T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 36,
    },
  ];
  const step1 = editRecord(p, { recordId: 'r1', count: 20, now: NOW });
  // 7/1グループ(r1単独)だけが引き直される: 20×3×1.5(自己ベスト更新)=90 → 59+(90-23)=126
  // 7/5(r2)のgrantedExpは36のまま変わらない（もう自己ベストではなくなったはずなのに残る）
  assert.equal(charExp(step1.player, 'hinoko'), 126);
  assert.equal(step1.player.records.find((r) => r.id === 'r2').grantedExp, 36, '7/5の残留（既知の割り切り）');

  const step2 = deleteRecord(step1.player, { recordId: 'r2', now: NOW });
  // 「7/5が最初から無かった」なら 90（=7/1単独）になるはずだが、実際は102。+12の残留
  assert.equal(charExp(step2.player, 'hinoko'), 102, '割り切りの結果としてこの値になる（あるべきは90）');
  assert.equal(step2.result.expDelta, -24);
});

test('S2 連続編集（既知の残留・固定・大きい数字）: ひのこ 5→500 のあと 400 を削除で exp=2850(Lv17) になる', () => {
  const p = base('hinoko');
  // 7/1:5かい(grant23) 7/5:400かい(自己ベスト更新,grant1800=400×3×1.5)
  p.chars[0].exp = 23 + 1800;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 5, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 23,
    },
    {
      id: 'r2', date: '2026-07-05', mode: 'no', count: 400, createdAt: '2026-07-05T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 1800,
    },
  ];
  const step1 = editRecord(p, { recordId: 'r1', count: 500, now: NOW });
  // 7/1単独: 500×3×1.5=2250 → 1823+(2250-23)=4050（Lv19）
  assert.equal(charExp(step1.player, 'hinoko'), 4050);
  assert.equal(levelFromExp(charExp(step1.player, 'hinoko')).level, 19);

  const step2 = deleteRecord(step1.player, { recordId: 'r2', now: NOW });
  // あるべきは2250(Lv15)＝7/1単独分だけ。実際は2850(Lv17)＝2レベルぶんの残留がある
  assert.equal(charExp(step2.player, 'hinoko'), 2850, '割り切りの結果としてこの値になる（あるべきは2250・Lv15）');
  assert.equal(levelFromExp(charExp(step2.player, 'hinoko')).level, 17);
});

test('S3 連続編集（既知の残留・固定・逆向き）: ひのこ 400→10 のあと 300 を削除で exp=0 になる', () => {
  const p = base('hinoko');
  // 7/1:400かい(自己ベスト更新,grant1800) 7/5:300かい(自己ベスト更新ではない,grant900=300×3)
  p.chars[0].exp = 1800 + 900;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 400, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 1800,
    },
    {
      id: 'r2', date: '2026-07-05', mode: 'no', count: 300, createdAt: '2026-07-05T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 900,
    },
  ];
  const step1 = editRecord(p, { recordId: 'r1', count: 10, now: NOW });
  // 7/1単独: 10×3×1.5(自己ベスト更新)=45 → 2700+(45-1800)=945
  assert.equal(charExp(step1.player, 'hinoko'), 945);

  const step2 = deleteRecord(step1.player, { recordId: 'r2', now: NOW });
  // あるべきは45(=7/1単独分)だが、実際は0にクランプされる（負債が持ち越されて0未満→0）
  assert.equal(charExp(step2.player, 'hinoko'), 0, '割り切りの結果としてこの値になる（あるべきは45）');
  assert.ok(charExp(step2.player, 'hinoko') >= 0);
});

test('S4 連続編集: 何度編集を重ねても exp と grantedExp は負にならない', () => {
  const p = base('hinoko');
  p.chars[0].exp = 1800 + 900;
  p.records = [
    {
      id: 'r1', date: '2026-07-01', mode: 'no', count: 400, createdAt: '2026-07-01T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 1800,
    },
    {
      id: 'r2', date: '2026-07-05', mode: 'no', count: 300, createdAt: '2026-07-05T09:00:00.000Z',
      charId: 'hinoko', grantedExp: 900,
    },
  ];
  // S3と同じ2手（945 → 0）のあと、さらに減らす・増やすを繰り返す
  const step1 = editRecord(p, { recordId: 'r1', count: 10, now: NOW });
  const step2 = deleteRecord(step1.player, { recordId: 'r2', now: NOW });
  assert.equal(charExp(step2.player, 'hinoko'), 0);

  // 3手目: すでにexp=0の状態でさらに 10→1 に減らす。負債はあっても0未満にはならない
  const step3 = editRecord(step2.player, { recordId: 'r1', count: 1, now: NOW });
  assert.equal(charExp(step3.player, 'hinoko'), 0);
  assert.equal(step3.result.expDelta, 0);
  const r1AfterStep3 = step3.player.records.find((r) => r.id === 'r1');
  assert.ok(r1AfterStep3.grantedExp >= 0, 'grantedExpが負にならない');
  assert.equal(r1AfterStep3.grantedExp, 5); // 1×3×1.5(自己ベスト更新)=4.5→round=5

  // 4手目: 1→100に増やして正常に回復することも確認（負のままにならない）
  const step4 = editRecord(step3.player, { recordId: 'r1', count: 100, now: NOW });
  assert.ok(charExp(step4.player, 'hinoko') >= 0);
  assert.equal(charExp(step4.player, 'hinoko'), 445);
  const r1AfterStep4 = step4.player.records.find((r) => r.id === 'r1');
  assert.ok(r1AfterStep4.grantedExp >= 0);
  assert.equal(r1AfterStep4.grantedExp, 450); // 100×3×1.5=450
});
