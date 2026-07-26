import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStreak, longestStreak } from '../js/core/streak.js';

test('記録がなければ 0', () => {
  assert.equal(currentStreak([], '2026-07-26'), 0);
  assert.equal(longestStreak([]), 0);
});

test('今日だけ記録があれば 1', () => {
  assert.equal(currentStreak(['2026-07-26'], '2026-07-26'), 1);
});

test('連続した日を数える', () => {
  const dates = ['2026-07-24', '2026-07-25', '2026-07-26'];
  assert.equal(currentStreak(dates, '2026-07-26'), 3);
});

test('昨日までの記録なら継続中とみなす（今日はまだやっていない）', () => {
  const dates = ['2026-07-24', '2026-07-25'];
  assert.equal(currentStreak(dates, '2026-07-26'), 2);
});

test('2日以上あくと 0 に戻る', () => {
  const dates = ['2026-07-20', '2026-07-21', '2026-07-22'];
  assert.equal(currentStreak(dates, '2026-07-26'), 0);
});

test('同じ日の複数記録は1日として数える', () => {
  const dates = ['2026-07-25', '2026-07-25', '2026-07-26', '2026-07-26'];
  assert.equal(currentStreak(dates, '2026-07-26'), 2);
});

test('月をまたいでも連続を数える', () => {
  const dates = ['2026-06-29', '2026-06-30', '2026-07-01'];
  assert.equal(currentStreak(dates, '2026-07-01'), 3);
  assert.equal(longestStreak(dates), 3);
});

test('うるう年の2月末をまたぐ（2028年はうるう年）', () => {
  const dates = ['2028-02-28', '2028-02-29', '2028-03-01'];
  assert.equal(longestStreak(dates), 3);
});

test('longestStreak は途切れた区間の最大を返す', () => {
  const dates = [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', // 4日
    '2026-07-10', '2026-07-11', // 2日
    '2026-07-20', // 1日
  ];
  assert.equal(longestStreak(dates), 4);
});

test('longestStreak は現在の連続が最長ならそれを返す', () => {
  const dates = ['2026-07-01', '2026-07-10', '2026-07-11', '2026-07-12'];
  assert.equal(longestStreak(dates), 3);
});

test('未来の日付があっても今日を基準に数える', () => {
  const dates = ['2026-07-25', '2026-07-26'];
  assert.equal(currentStreak(dates, '2026-07-26'), 2);
});
