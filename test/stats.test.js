import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyBest, personalBest, recordedDates, dailyBestSeries, personalBestDates } from '../js/core/stats.js';

const rec = (date, mode, count) => ({ id: `${date}-${mode}-${count}`, date, mode, count, createdAt: `${date}T10:00:00.000Z` });

const SAMPLE = [
  rec('2026-07-01', 'no', 8),
  rec('2026-07-01', 'no', 12),
  rec('2026-07-01', 'one', 40),
  rec('2026-07-03', 'no', 10),
  rec('2026-07-03', 'one', 55),
];

test('dailyBest は その日・そのモードの最大値', () => {
  assert.equal(dailyBest(SAMPLE, '2026-07-01', 'no'), 12);
  assert.equal(dailyBest(SAMPLE, '2026-07-01', 'one'), 40);
  assert.equal(dailyBest(SAMPLE, '2026-07-03', 'no'), 10);
});

test('dailyBest は記録のない日・モードで 0', () => {
  assert.equal(dailyBest(SAMPLE, '2026-07-02', 'no'), 0);
  assert.equal(dailyBest([], '2026-07-01', 'no'), 0);
});

test('personalBest は全期間の最大値', () => {
  assert.equal(personalBest(SAMPLE, 'no'), 12);
  assert.equal(personalBest(SAMPLE, 'one'), 55);
  assert.equal(personalBest([], 'no'), 0);
});

test('recordedDates は重複なし昇順', () => {
  assert.deepEqual(recordedDates(SAMPLE), ['2026-07-01', '2026-07-03']);
});

test('dailyBestSeries は日付昇順で日別ベストを返す（記録のない日は含めない）', () => {
  assert.deepEqual(dailyBestSeries(SAMPLE, 'no'), [
    { date: '2026-07-01', count: 12 },
    { date: '2026-07-03', count: 10 },
  ]);
  assert.deepEqual(dailyBestSeries(SAMPLE, 'one'), [
    { date: '2026-07-01', count: 40 },
    { date: '2026-07-03', count: 55 },
  ]);
});

test('personalBestDates は自己ベストを更新した日だけを含む', () => {
  // no: 7/1 に 12（更新）、7/3 は 10 なので更新なし
  // one: 7/1 に 40（更新）、7/3 に 55（更新）
  const dates = personalBestDates(SAMPLE);
  assert.ok(dates.has('2026-07-01'));
  assert.ok(dates.has('2026-07-03')); // one の更新があるため
  assert.equal(dates.size, 2);
});

test('personalBestDates は同点では更新とみなさない', () => {
  const records = [rec('2026-07-01', 'no', 10), rec('2026-07-02', 'no', 10)];
  const dates = personalBestDates(records);
  assert.ok(dates.has('2026-07-01'));
  assert.ok(!dates.has('2026-07-02'));
});

test('入力配列を書き換えない', () => {
  const input = [rec('2026-07-05', 'no', 3), rec('2026-07-04', 'no', 5)];
  const copy = JSON.parse(JSON.stringify(input));
  recordedDates(input);
  dailyBestSeries(input, 'no');
  personalBestDates(input);
  assert.deepEqual(input, copy);
});
