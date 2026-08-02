import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, MODE_RATE, STARTER_IDS, getCharacter } from '../js/core/characters.js';

test('モード係数はノー3・ワン1', () => {
  assert.deepEqual(MODE_RATE, { no: 3, one: 1 });
});

test('キャラは9体で、No.は1から9まで重複なし', () => {
  assert.equal(CHARACTERS.length, 9);
  assert.deepEqual(CHARACTERS.map((c) => c.no), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, 9);
});

test('御三家3体は unlockLevel 0', () => {
  assert.deepEqual(STARTER_IDS, ['hinoko', 'shizuku', 'happa']);
  for (const id of STARTER_IDS) {
    assert.equal(getCharacter(id).unlockLevel, 0);
  }
});

test('No.5〜9の解放条件は設計どおり', () => {
  assert.equal(getCharacter('mokumo').unlockLevel, 30);
  assert.equal(getCharacter('kirara').unlockLevel, 40);
  assert.equal(getCharacter('kooru').unlockLevel, 50);

  const ganro = getCharacter('ganro');
  assert.equal(ganro.unlockLevel, null);
  assert.equal(ganro.unlockOnEvolvedStage, 2);
  assert.equal(ganro.unlockOnEvolvedCount, 1);

  const kagero = getCharacter('kagero');
  assert.equal(kagero.unlockLevel, null);
  assert.equal(kagero.unlockOnEvolvedStage, 2);
  assert.equal(kagero.unlockOnEvolvedCount, 2);
});

// =============================================================================
// 2026-07-30 安部さんの依頼: ぴかり(No.4)の解放条件を「Lv30到達」から
// 「なかまの誰かが だい1しんか(stage:1)を達成した」に変える。
// ぴかりはもうレベルの節目を持たない（unlockLevel は null）。かわりに
// 「進化のどの段階に到達したら解放されるか」を unlockOnEvolvedStage で持つ、
// という設計（安部さんの提案どおり）をここで固定する。
// =============================================================================

test('ぴかりはレベルの節目ではなく、だい1しんか(stage:1)の実現で解放される', () => {
  const pikari = getCharacter('pikari');
  assert.equal(pikari.unlockLevel, null, 'もうレベルでは解放されない');
  assert.equal(pikari.unlockOnEvolvedStage, 1, 'なかまの誰かがだい1しんか(stage 1)を実現すると解放される');
  assert.equal(pikari.unlockOnEvolvedCount, 1);
});

test('全キャラが進化を2段階持ち、第2進化は oneCount が null', () => {
  for (const c of CHARACTERS) {
    assert.equal(c.evolutions.length, 2, `${c.id} の進化段階数`);
    assert.equal(c.evolutions[0].stage, 1);
    assert.equal(c.evolutions[1].stage, 2);
    assert.equal(typeof c.evolutions[0].oneCount, 'number', `${c.id} の第1進化はワンでも可`);
    assert.equal(c.evolutions[1].oneCount, null, `${c.id} の第2進化はノーのみ`);
  }
});

test('進化条件の具体値（ひのこ・もくも・かげろ）', () => {
  assert.deepEqual(getCharacter('hinoko').evolutions, [
    { stage: 1, level: 15, noCount: 15, oneCount: 50, streak: 5 },
    { stage: 2, level: 45, noCount: 40, oneCount: null, streak: 14 },
  ]);
  assert.deepEqual(getCharacter('mokumo').evolutions[0],
    { stage: 1, level: 15, noCount: 18, oneCount: 30, streak: 5 });
  assert.deepEqual(getCharacter('kagero').evolutions[1],
    { stage: 2, level: 70, noCount: 100, oneCount: null, streak: 30 });
});

test('もくもの第1進化ワン条件が全キャラ中もっともゆるい', () => {
  const others = CHARACTERS.filter((c) => c.id !== 'mokumo').map((c) => c.evolutions[0].oneCount);
  assert.ok(getCharacter('mokumo').evolutions[0].oneCount < Math.min(...others));
});

test('全キャラが特性・タイプ・説明文・色を持つ', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.ability && c.ability.id && c.ability.name && c.ability.text, `${c.id} の特性`);
    assert.ok(c.type.length > 0, `${c.id} のタイプ`);
    assert.ok(c.dexText.length >= 10, `${c.id} の説明文`);
    assert.match(c.color, /^#[0-9a-f]{6}$/i, `${c.id} の色`);
  }
});

test('getCharacter は未知のIDで例外を投げる', () => {
  assert.throws(() => getCharacter('nazono'), /nazono/);
});
