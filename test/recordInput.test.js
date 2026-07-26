import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJaDate, dateBounds, dateOutOfRangeReason } from '../js/views/recordInput.js';

test('formatJaDate は「◯がつ◯にち」の形にする（UTC変換を経由しない）', () => {
  assert.equal(formatJaDate('2026-07-20'), '7がつ20にち');
  assert.equal(formatJaDate('2026-01-01'), '1がつ1にち');
  assert.equal(formatJaDate('2026-12-31'), '12がつ31にち');
});

test('dateBounds は今日から1年前を下限にする（月日はそのまま）', () => {
  assert.deepEqual(dateBounds('2026-07-27'), { min: '2025-07-27', max: '2026-07-27' });
});

test('dateBounds は年境界・うるう年の2/29も正しく1年ずらす', () => {
  // 2024年はうるう年。2024-02-29 の1年前は2023-02-29が存在しないので、
  // Date.UTC の繰り上がりで 2023-03-01 になる（意図した仕様の範囲）
  const { min } = dateBounds('2024-02-29');
  assert.equal(min, '2023-03-01');
});

test('dateOutOfRangeReason は範囲内なら null', () => {
  assert.equal(dateOutOfRangeReason('2026-07-27', '2026-07-27'), null);
  assert.equal(dateOutOfRangeReason('2026-07-26', '2026-07-27'), null);
  assert.equal(dateOutOfRangeReason('2025-07-27', '2026-07-27'), null);
});

// 理由の文言まで固定する。typeof だけ見ていると、未来日と「1年より前」の
// メッセージが入れ替わっても気づけない
test('dateOutOfRangeReason は未来日を「みらいの ひ」として拒否する', () => {
  assert.match(dateOutOfRangeReason('2026-07-28', '2026-07-27'), /みらいの ひ/);
});

test('dateOutOfRangeReason は1年より前を「1ねんより まえ」として拒否する', () => {
  assert.match(dateOutOfRangeReason('2025-07-26', '2026-07-27'), /1ねんより まえ/);
});

test('dateOutOfRangeReason は未選択（空文字）を理由付きで拒否する', () => {
  assert.equal(typeof dateOutOfRangeReason('', '2026-07-27'), 'string');
});
