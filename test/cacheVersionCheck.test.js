import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDeployablePath,
  readCacheName,
  checkCacheVersion,
} from '../tools/check-cache-version.js';

const sw = (version) => `const CACHE_NAME = 'liftingmaster-v${version}';`;
const SCRIPT = fileURLToPath(new URL('../tools/check-cache-version.js', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('文書だけの変更はCACHE_NAME版上げを要求しない', () => {
  assert.deepEqual(
    checkCacheVersion({
      changedPaths: ['HANDOFF.md', 'docs/note.md'],
      baseSw: sw(14),
      headSw: sw(14),
    }),
    {
      ok: true,
      deployableChanged: false,
      message: '配信対象の変更なし',
    },
  );
});

test('JavaScript変更でCACHE_NAMEが同じなら拒否する', () => {
  const result = checkCacheVersion({
    changedPaths: ['js/core/player.js'],
    baseSw: sw(14),
    headSw: sw(14),
  });
  assert.equal(result.ok, false);
  assert.equal(result.deployableChanged, true);
  assert.match(result.message, /CACHE_NAME.*変更されていない/);
});

test('画像追加でCACHE_NAMEが変わっていれば許可する', () => {
  assert.equal(checkCacheVersion({
    changedPaths: ['js/img/pikari-0.png'],
    baseSw: sw(14),
    headSw: sw(15),
  }).ok, true);
});

test('CSS削除も配信対象変更として扱う', () => {
  assert.equal(isDeployablePath('css/old.css'), true);
});

test('sw.jsだけの変更も配信対象変更として扱う', () => {
  assert.equal(isDeployablePath('sw.js'), true);
});

test('開発用ファイルは配信対象にしない', () => {
  for (const path of [
    'test/player.test.js',
    'tools/serve.js',
    '.github/workflows/test.yml',
    'package.json',
    'README.md',
  ]) assert.equal(isDeployablePath(path), false, path);
});

test('不正なCACHE_NAMEを拒否する', () => {
  assert.throws(() => readCacheName("const CACHE_NAME = 'cache';"), /liftingmaster-v/);
});

test('複数桁の版番号をそのまま比較できる', () => {
  assert.equal(readCacheName(sw(123)), 'liftingmaster-v123');
});

test('CLIは配信変更の版上げ漏れを拒否し、版上げ後は許可する', () => {
  const repo = mkdtempSync(join(tmpdir(), 'lifting-cache-check-'));
  try {
    git(repo, 'init');
    git(repo, 'config', 'user.name', 'Cache Check Test');
    git(repo, 'config', 'user.email', 'cache-check@example.invalid');
    git(repo, 'config', 'core.autocrlf', 'false');
    mkdirSync(join(repo, 'js'));
    writeFileSync(join(repo, 'sw.js'), sw(14));
    writeFileSync(join(repo, 'js', 'app.js'), 'export const value = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');

    writeFileSync(join(repo, 'js', 'app.js'), 'export const value = 2;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'change app without cache bump');
    const unchangedCache = git(repo, 'rev-parse', 'HEAD');

    let result = spawnSync(process.execPath, [SCRIPT, base, unchangedCache], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /CACHE_NAME.*変更されていない/);

    writeFileSync(join(repo, 'sw.js'), sw(15));
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'bump cache');
    const bumpedCache = git(repo, 'rev-parse', 'HEAD');

    result = spawnSync(process.execPath, [SCRIPT, base, bumpedCache], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /liftingmaster-v14 -> liftingmaster-v15/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
