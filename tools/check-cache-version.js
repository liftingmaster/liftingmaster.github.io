import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CACHE_RE = /CACHE_NAME\s*=\s*'(?<name>liftingmaster-v\d+)'/;

export function isDeployablePath(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized === 'index.html'
    || normalized === 'manifest.json'
    || normalized === 'sw.js'
    || normalized.startsWith('css/')
    || normalized.startsWith('js/')
    || normalized.startsWith('icons/');
}

export function readCacheName(swSource) {
  const name = swSource.match(CACHE_RE)?.groups?.name;
  if (!name) throw new Error("CACHE_NAME が 'liftingmaster-v<整数>' の形でない");
  return name;
}

export function checkCacheVersion({ changedPaths, baseSw, headSw }) {
  const deployableChanged = changedPaths.some(isDeployablePath);
  if (!deployableChanged) {
    return { ok: true, deployableChanged: false, message: '配信対象の変更なし' };
  }

  const baseName = readCacheName(baseSw);
  const headName = readCacheName(headSw);
  if (baseName === headName) {
    return {
      ok: false,
      deployableChanged: true,
      message: `配信対象を変更したが CACHE_NAME が変更されていない: ${headName}`,
    };
  }
  const baseVersion = Number(baseName.slice('liftingmaster-v'.length));
  const headVersion = Number(headName.slice('liftingmaster-v'.length));
  if (headVersion <= baseVersion) {
    return {
      ok: false,
      deployableChanged: true,
      message: `CACHE_NAME は基準より大きい版番号にする: ${baseName} -> ${headName}`,
    };
  }

  return {
    ok: true,
    deployableChanged: true,
    message: `CACHE_NAME: ${baseName} -> ${headName}`,
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

export function runCli(argv) {
  const [base, head] = argv;
  if (!base || !head) {
    throw new Error('usage: node tools/check-cache-version.js <base-commit> <head-commit>');
  }

  const changedPaths = git([
    'diff',
    '--no-renames',
    '--name-only',
    '--diff-filter=ACDMRT',
    `${base}...${head}`,
  ]).split(/\r?\n/).filter(Boolean);

  const result = checkCacheVersion({
    changedPaths,
    baseSw: git(['show', `${base}:sw.js`]),
    headSw: git(['show', `${head}:sw.js`]),
  });
  console.log(result.message);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
