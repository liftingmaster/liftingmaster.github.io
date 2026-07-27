/**
 * 散文で決めた約束を、機械で検査する場所。
 *
 * この案件では「README やコメントに書いた約束が、あとで別のファイルで破られる」
 * ことが繰り返し起きた。人が思い出して守る仕組みは、担当が変わると効かない。
 * 約束を決めたら、ここに1本足すこと。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 配信対象になるファイルを列挙する（開発用のフォルダは除く） */
function servableFiles() {
  const SKIP = new Set(['node_modules', '.git', '.superpowers', 'incoming-art', 'test', 'tools', 'docs', 'icons']);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        walk(full);
      } else if (/\.(js|css|html|json|png)$/.test(entry.name)) {
        out.push(relative(ROOT, full).split(sep).join('/'));
      }
    }
  };
  walk(ROOT);
  // sw.js 自身と、配信されない開発用の設定は対象外
  return out.filter((f) => f !== 'sw.js' && f !== 'package.json');
}

function swAssets() {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  return new Set(
    [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean),
  );
}

// 破ったときの症状：家族のタブレットがオフラインでその画面だけ壊れる。
// 開発機では絶対に再現しない（ネットワークがあるので取りに行けてしまう）。
// 実際に backupPrompt.js で1回やらかしている。
test('配信するファイルは全て sw.js の ASSETS に載っている（オフラインで壊れないこと）', () => {
  const listed = swAssets();
  const missing = servableFiles().filter((f) => !listed.has(f));
  assert.deepEqual(
    missing, [],
    `sw.js の ASSETS に足りていない: ${missing.join(', ')}\n`
    + 'ファイルを増やしたら ASSETS への追加と CACHE_NAME の版上げが要る',
  );
});

test('sw.js の ASSETS に、存在しないファイルが載っていない', () => {
  const ghosts = [...swAssets()].filter((f) => {
    if (f === '' || f === './') return false;
    try { statSync(join(ROOT, f)); return false; } catch { return true; }
  });
  assert.deepEqual(ghosts, [], `sw.js が実在しないファイルを指している: ${ghosts.join(', ')}`);
});

// js/core を DOM から隔離しているからこそ、ブラウザ無しで全ロジックをテストできる。
// ここが崩れるとテスト戦略の前提ごと崩れる。実際に imgFallback.js が1度混入した。
test('js/core は DOM・localStorage・時計に触れない（純粋関数だけを置く約束）', () => {
  const dir = join(ROOT, 'js', 'core');
  const offenders = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // ブロックコメントを除く
      .replace(/(^|[^:])\/\/.*$/gm, '$1');   // 行コメントを除く
    for (const banned of ['document', 'window', 'localStorage', 'Date.now(', 'navigator']) {
      if (src.includes(banned)) offenders.push(`${name}: ${banned}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `js/core に環境依存の参照がある: ${offenders.join(', ')}\n`
    + '時刻や DOM が要るものは js/ 直下（app.js と同じ階層）へ置くこと',
  );
});
