import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChartSvg } from '../js/svg/chart.js';

const series = (points, mode = 'no', color = '#ff6b3d') => ({ mode, color, points });

test('SVG文字列を返す', () => {
  const svg = lineChartSvg([series([{ date: '2026-07-01', count: 5 }, { date: '2026-07-02', count: 8 }])]);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('データが空なら案内文を出す', () => {
  assert.ok(lineChartSvg([]).includes('まだ きろくが ないよ'));
  assert.ok(lineChartSvg([series([])]).includes('まだ きろくが ないよ'));
});

test('点の数だけ circle が描かれる', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 5 },
    { date: '2026-07-02', count: 8 },
    { date: '2026-07-03', count: 3 },
  ])]);
  assert.equal((svg.match(/<circle/g) || []).length, 3);
});

test('1点だけでも描ける（線は引かない）', () => {
  const svg = lineChartSvg([series([{ date: '2026-07-01', count: 5 }])]);
  assert.equal((svg.match(/<circle/g) || []).length, 1);
  assert.ok(!svg.includes('<polyline'));
});

test('2系列を別の色で描く', () => {
  const svg = lineChartSvg([
    series([{ date: '2026-07-01', count: 5 }, { date: '2026-07-02', count: 8 }], 'no', '#ff0000'),
    series([{ date: '2026-07-01', count: 40 }, { date: '2026-07-02', count: 60 }], 'one', '#0000ff'),
  ]);
  assert.ok(svg.includes('#ff0000'));
  assert.ok(svg.includes('#0000ff'));
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
});

test('日付の間隔がX座標に反映される（間があいた日は横に離れる）', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-02', count: 10 },
    { date: '2026-07-31', count: 10 },
  ])]);
  const xs = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(xs.length, 3);
  const gap1 = xs[1] - xs[0];
  const gap2 = xs[2] - xs[1];
  assert.ok(gap2 > gap1 * 10, `1日の間隔 ${gap1} に対し29日の間隔 ${gap2} が広くない`);
});

test('最大値がグラフ上端側に来る', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 1 },
    { date: '2026-07-02', count: 100 },
  ])], { height: 300 });
  const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ys[1] < ys[0], 'SVGのY軸は下向きなので、大きい値ほどcyが小さいはず');
});

test('全部同じ値でも描ける（ゼロ除算しない）', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-02', count: 10 },
  ])]);
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('Infinity'));
});

test('同じ日が1点しかない系列と複数点の系列が混在しても NaN を出さない', () => {
  const svg = lineChartSvg([
    series([{ date: '2026-07-01', count: 5 }], 'no', '#ff0000'),
    series([{ date: '2026-07-01', count: 40 }, { date: '2026-07-05', count: 55 }], 'one', '#0000ff'),
  ]);
  assert.ok(!svg.includes('NaN'));
});

test('外部リソースを参照しない', () => {
  const svg = lineChartSvg([series([{ date: '2026-07-01', count: 5 }])]).replace('http://www.w3.org/2000/svg', '');
  assert.ok(!svg.includes('http'));
  assert.ok(!svg.includes('<script'));
});

test('6日間隔は接続される（GAP_BREAK_DAYS=7が境界）', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-07', count: 10 },
  ])]);
  assert.equal((svg.match(/<polyline/g) || []).length, 1, '6日間隔なので1本の polyline');
});

test('7日間隔は接続されない（GAP_BREAK_DAYS=7が境界）', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-08', count: 10 },
  ])]);
  assert.equal((svg.match(/<polyline/g) || []).length, 0, '7日間隔なので polyline なし（両点が孤立）');
});

test('3点で中間が7日以上離れると、2つの polyline に分かれる', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-02', count: 10 },
    { date: '2026-07-31', count: 10 },
  ])]);
  assert.equal((svg.match(/<polyline/g) || []).length, 1, '07-01→07-02 で1本、07-31 は孤立');
});

test('ギャップの両側の点すべてが circle で描かれる', () => {
  const svg = lineChartSvg([series([
    { date: '2026-07-01', count: 10 },
    { date: '2026-07-02', count: 10 },
    { date: '2026-07-31', count: 10 },
  ])]);
  assert.equal((svg.match(/<circle/g) || []).length, 3, '3点すべてに circle がある');
});
