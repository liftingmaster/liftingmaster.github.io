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
  // .claude は開発ツールの設定（launch.json など）。配信もキャッシュもしない。
  // ここに入れ忘れると sw.js の ASSETS に足せと言われるが、足すと GitHub Pages で
  // 配信されなかったときに cache.addAll がまるごと失敗し、オフライン対応が死ぬ
  const SKIP = new Set(['node_modules', '.git', '.claude', '.superpowers', 'incoming-art', 'test', 'tools', 'docs', 'icons']);
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

// 記録の修正機能（docs/superpowers/specs/2026-07-27-record-edit-and-dual-mode.md §3.4/§3.5）で
// 新設予定の2ファイル。sw.js の ASSETS に登録し忘れると、オフライン端末でこの機能だけ壊れる
// （progress.md の「罠1」と同種）。CACHE_NAME を上げ忘れると修正が端末に届かない（罠2）。
test('記録の修正機能で新設する js/views/passwordGate.js・evolutionEffect.js が存在し、ASSETSに載っている', () => {
  const expected = ['js/views/passwordGate.js', 'js/views/evolutionEffect.js'];
  for (const rel of expected) {
    let exists = true;
    try { statSync(join(ROOT, rel)); } catch { exists = false; }
    assert.ok(exists, `${rel} が存在しない（仕様§3.4/§3.5で新設予定）`);
  }
  const listed = swAssets();
  for (const rel of expected) {
    assert.ok(listed.has(rel), `sw.js の ASSETS に ${rel} が無い`);
  }
});

test('記録の修正機能の新設ファイル追加に合わせて CACHE_NAME が v6 から上がっている', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotMatch(
    sw, /CACHE_NAME\s*=\s*'liftingmaster-v6'/,
    'js/views/passwordGate.js・evolutionEffect.js を追加したら CACHE_NAME も上げること',
  );
});

// しずく・はっぱの画像差し替え（御三家の残り2体）で新設予定の6ファイル
// （js/img/shizuku-0/1/2.png・js/img/happa-0/1/2.png）。
// 上の「配信するファイルは全て sw.js の ASSETS に載っている」は js/img 配下も
// 自動で拾うため、実は足し忘れればそちらでも落ちる。ただし ART に載っている
// ものだけをひのこと同じ形で明示チェックしておくと、症状（ASSETS漏れ）と
// 原因（このタスクで増やしたはずのファイル）が1本のテスト名で直結する。
test('しずく・はっぱの画像差し替えで新設する js/img/ の6ファイルが存在し、ASSETSに載っている', () => {
  const expected = [
    'js/img/shizuku-0.png', 'js/img/shizuku-1.png', 'js/img/shizuku-2.png',
    'js/img/happa-0.png', 'js/img/happa-1.png', 'js/img/happa-2.png',
  ];
  for (const rel of expected) {
    let exists = true;
    try { statSync(join(ROOT, rel)); } catch { exists = false; }
    assert.ok(exists, `${rel} が存在しない（tools/prepare-art.js で生成予定）`);
  }
  const listed = swAssets();
  for (const rel of expected) {
    // swAssets() は正規表現 '\.\/([^']*)' の捕獲群を返すため、先頭の './' は付かない
    assert.ok(listed.has(rel), `sw.js の ASSETS に ./${rel} が無い`);
  }
});

test('しずく・はっぱの画像差し替えに合わせて CACHE_NAME が v9 から上がっている', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotMatch(
    sw, /CACHE_NAME\s*=\s*'liftingmaster-v9'/,
    'js/img/shizuku-*.png・happa-*.png を追加したら CACHE_NAME も上げること（v9のままではオフライン端末に届かない）',
  );
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

// 追加（実装者・2026-07-28）: CACHE_NAME が単調に増えることを見る。
//
// 上の検査は「特定の版でないこと」しか見ていないため、過去に使った名前
// （例 liftingmaster-v8）へ戻しても緑のまま通ってしまう。しかし Service Worker は
// キャッシュ名で中身を引くので、一度使った名前へ戻すと、その名前でキャッシュ済みの
// 端末には**古いファイルが残ったまま**になり、更新が届かない。
// 版番号を読み取って、これまでに使った最大値以上であることを確かめる。
//
// 版を上げたら、この下限もいっしょに上げること（上げ忘れても緑にはならない。
// 下限より小さい版に戻したときだけ落ちる）。
const CACHE_VERSION_FLOOR = 10;

test('sw.js の CACHE_NAME は liftingmaster-v<数字> の形で、過去に使った版へ戻っていない', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/CACHE_NAME\s*=\s*'liftingmaster-v(\d+)'/);
  assert.ok(m, "CACHE_NAME が 'liftingmaster-v<数字>' の形になっていない");
  const version = Number(m[1]);
  assert.ok(
    Number.isInteger(version) && version >= CACHE_VERSION_FLOOR,
    `CACHE_NAME が v${version} になっている。過去に使った版（v${CACHE_VERSION_FLOOR} 以下）へ戻すと、`
    + 'その名前でキャッシュ済みの端末に古いファイルが残り続ける',
  );
});
