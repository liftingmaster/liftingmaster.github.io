import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('CIはNode 24で全テストとPRのCACHE_NAME検査を実行する', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /^name:\s*test$/m);
  assert.match(workflow, /^\s{2}node-test:$/m);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /node --test test\/\*\.test\.js/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /tools\/check-cache-version\.js/);
  assert.doesNotMatch(workflow, /npm (ci|install)/);
});
