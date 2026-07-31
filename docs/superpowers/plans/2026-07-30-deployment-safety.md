# 本番配信安全化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番アプリの配信ファイルを変えずに、420テスト、CACHE_NAME版上げ、PR経由の配信を自動的に強制する。

**Architecture:** CACHE_NAMEの判定を純粋関数として `tools/check-cache-version.js` に実装し、薄いCLI層だけがGitから差分と各版の `sw.js` を取得する。GitHub ActionsはNode 24で全テストとこのCLIを実行し、実動確認後にGitHubの `main` 保護を有効化する。

**Tech Stack:** Node.js 24、`node:test`、Git、GitHub Actions、GitHub CLI/API

## Global Constraints

- `main` へのpushは本番反映であり、実装中は行わない。
- アプリ本体のJavaScript、CSS、HTML、画像、現在の `sw.js`、`CACHE_NAME = liftingmaster-v14` は変更しない。
- 依存パッケージを追加せず、`npm install` を実行しない。
- テストコマンドは `node --test test/*.test.js` を使用する。
- PR上の `node-test` 成功を確認するまでブランチ保護を変更しない。
- Pages設定、公開URL、リポジトリ名、localStorageスキーマ、EXP処理は変更しない。

---

## File Map

- Create: `tools/check-cache-version.js` — 配信対象判定、CACHE_NAME比較、Git CLIアダプター
- Create: `test/cacheVersionCheck.test.js` — 純粋判定関数とCLIエラーの回帰テスト
- Create: `.github/workflows/test.yml` — Node 24の全テストとPR差分検査
- Create: `test/ciWorkflow.test.js` — Workflowの必須設定を固定する静的検査
- Modify: `HANDOFF.md` — 最新コミットとService Worker説明の事実誤認を修正
- Modify: `docs/superpowers/specs/2026-07-30-deployment-safety-design.md` — `sw.js`を配信対象へ明記

---

### Task 1: CACHE_NAME版上げ判定

**Files:**
- Create: `test/cacheVersionCheck.test.js`
- Create: `tools/check-cache-version.js`

**Interfaces:**
- Produces: `isDeployablePath(path: string): boolean`
- Produces: `readCacheName(swSource: string): string`
- Produces: `checkCacheVersion({ changedPaths: string[], baseSw: string, headSw: string }): { ok: boolean, deployableChanged: boolean, message: string }`
- CLI: `node tools/check-cache-version.js <base-commit> <head-commit>`、成功はexit 0、検査違反・取得失敗はexit 1

- [ ] **Step 1: テスト規約を読む**

Read: `test/invariants.test.js`、`test/prepare-art.test.js`、`superpowers:test-driven-development` が参照する `writing-good-tests.md`。

テスト対象を先に言語化する: `checkCacheVersion()` の判定を壊す本番変更は、配信対象パス判定またはCACHE_NAME比較の変更である。

- [ ] **Step 2: 純粋関数の失敗テストを書く**

Create `test/cacheVersionCheck.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeployablePath,
  readCacheName,
  checkCacheVersion,
} from '../tools/check-cache-version.js';

const sw = (version) => `const CACHE_NAME = 'liftingmaster-v${version}';`;

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
```

- [ ] **Step 3: REDを確認する**

Run:

```bash
node --test test/cacheVersionCheck.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` で失敗する。実装ファイルがまだ無いことが原因であると確認する。

- [ ] **Step 4: 最小実装を書く**

Create `tools/check-cache-version.js`。純粋関数は次の契約で実装する。

```js
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
  return {
    ok: true,
    deployableChanged: true,
    message: `CACHE_NAME: ${baseName} -> ${headName}`,
  };
}
```

同じファイル末尾にCLIを置く。`execFileSync('git', args, { encoding: 'utf8' })` を使い、shell文字列を組み立てない。

```js
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

export function runCli(argv) {
  const [base, head] = argv;
  if (!base || !head) throw new Error('usage: node tools/check-cache-version.js <base-commit> <head-commit>');
  const changedPaths = git(['diff', '--name-only', '--diff-filter=ACDMRT', `${base}...${head}`])
    .split(/\r?\n/)
    .filter(Boolean);
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
```

- [ ] **Step 5: GREENを確認する**

Run:

```bash
node --test test/cacheVersionCheck.test.js
node tools/check-cache-version.js HEAD~1 HEAD
```

Expected: 単体テストは全件成功。現在の差分は文書だけなのでCLIは `配信対象の変更なし`、exit 0。

- [ ] **Step 6: CLIの失敗経路をテストする**

`test/cacheVersionCheck.test.js` に一時Gitリポジトリを作る統合テストを追加する。`mkdtempSync`、`writeFileSync`、`execFileSync` を使い、基準commitに `sw.js` v14と `js/app.js`、対象commitに変更した `js/app.js` と同じv14を置く。CLIを `spawnSync(process.execPath, [SCRIPT, base, head], { cwd: repo, encoding: 'utf8' })` で呼び、次を確認する。

```js
assert.equal(result.status, 1);
assert.match(result.stdout, /CACHE_NAME.*変更されていない/);
```

その後、対象commitの `sw.js` をv15へ変更した3つ目のcommitを作り、exit 0と `v14 -> v15` を確認する。

- [ ] **Step 7: RED→GREENを確認する**

統合テストを先にCLI呼び出し未対応の状態で実行し、想定した失敗を確認してからCLIを完成させる。

Run:

```bash
node --test test/cacheVersionCheck.test.js
```

Expected: 全件成功。

- [ ] **Step 8: Task 1をcommitする**

```bash
git add tools/check-cache-version.js test/cacheVersionCheck.test.js
git commit -m "test: require cache bump for deployable changes"
```

---

### Task 2: GitHub Actions

**Files:**
- Create: `test/ciWorkflow.test.js`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `node tools/check-cache-version.js <base-commit> <head-commit>`
- Produces: GitHub必須チェック名 `node-test`

- [ ] **Step 1: Workflowの失敗テストを書く**

Create `test/ciWorkflow.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('CIはNode 24で全テストとPRのCACHE_NAME検査を実行する', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /^name:\s*test$/m);
  assert.match(workflow, /^\s{2}node-test:$/m);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /node --test test\/\*\.test\.js/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /tools\/check-cache-version\.js/);
  assert.doesNotMatch(workflow, /npm (ci|install)/);
});
```

- [ ] **Step 2: REDを確認する**

Run:

```bash
node --test test/ciWorkflow.test.js
```

Expected: `.github/workflows/test.yml` が存在せず失敗する。

- [ ] **Step 3: Workflowを最小実装する**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  node-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Run all tests
        run: node --test test/*.test.js
      - name: Require CACHE_NAME bump for deployable changes
        if: github.event_name == 'pull_request'
        run: >-
          node tools/check-cache-version.js
          ${{ github.event.pull_request.base.sha }}
          ${{ github.event.pull_request.head.sha }}
```

- [ ] **Step 4: GREENを確認する**

Run:

```bash
node --test test/ciWorkflow.test.js
node --test test/*.test.js
```

Expected: 新規Workflowテスト成功、全テストは既存420件＋新規分が全件成功。

- [ ] **Step 5: Task 2をcommitする**

```bash
git add .github/workflows/test.yml test/ciWorkflow.test.js
git commit -m "ci: run tests and cache version guard"
```

---

### Task 3: HANDOFF.mdの事実修正

**Files:**
- Modify: `HANDOFF.md:76-80`
- Modify: `HANDOFF.md:98-100`
- Modify: `HANDOFF.md:232-246`
- Modify: `HANDOFF.md:539-577`

**Interfaces:**
- Consumes: 実コード `sw.js:55-82`、新規Workflow `.github/workflows/test.yml`
- Produces: 次の担当者が実コードと一致する運用説明

- [ ] **Step 1: 最新コミットの固定値を削除する**

`HANDOFF.md` の「最新コミット」を次へ変更する。

```markdown
- **最新コミット**: 固定値は書かない。`git log -1 --oneline` で実物を確認
```

- [ ] **Step 2: ASSETS説明を実装と一致させる**

100行付近を次の意味へ修正する。

```markdown
**特に画像ファイル**は必須。`ASSETS` はインストール時に事前キャッシュする一覧。
未登録でもオンライン時の初回アクセスではネットワーク取得され、成功すれば動的にキャッシュされるが、
未取得の端末ではオフライン表示が壊れる。初回から確実にPWAをオフライン利用できるよう必ず登録する。
```

罠1の原因も「ASSETSリストのファイルだけがインストール時に事前キャッシュされる」とする。

- [ ] **Step 3: 機械検査の説明を更新する**

246行付近と572行付近の「機械では判定できない」を、次の二層へ修正する。

- `test/invariants.test.js`: 形式と過去版への巻き戻しを検査
- `tools/check-cache-version.js`: PRの配信対象差分に対する今回の版上げを検査

GitHubの事実表は「CI / Actionsあり」「PRで420テストとCACHE_NAME検査」と更新する。ただしブランチ保護は実際に設定するまで「なし」のままにし、設定完了後のTask 6で更新する。

- [ ] **Step 4: 文書差分を検証する**

Run:

```bash
rg -n "最新コミット|ASSETS|キャッシュ内のファイルだけ|機械では判定できない|CI / Actions" HANDOFF.md
git diff --check
```

Expected: 固定ハッシュと誤った「キャッシュ内だけ」表現が消え、CIと二層検査が記載される。

- [ ] **Step 5: 全テストを実行する**

Run:

```bash
node --test test/*.test.js
```

Expected: 全件成功。

- [ ] **Step 6: Task 3をcommitする**

```bash
git add HANDOFF.md docs/superpowers/specs/2026-07-30-deployment-safety-design.md
git commit -m "docs: correct deployment safety guidance"
```

---

### Task 4: ローカル最終検証とレビュー

**Files:**
- Review only: 全変更

**Interfaces:**
- Produces: PRへ送れる検証済みbranch

- [ ] **Step 1: 配信ファイル無変更を確認する**

Run:

```bash
git diff --name-only origin/main...HEAD
git diff --name-only origin/main...HEAD -- index.html manifest.json sw.js css js icons
```

Expected: 1つ目は文書・テスト・tools・Workflowのみ。2つ目は出力なし。

- [ ] **Step 2: 全検証を新しく実行する**

Run:

```bash
node --test test/*.test.js
node tools/check-cache-version.js origin/main HEAD
git diff --check origin/main...HEAD
git status --short
```

Expected:

- 全テスト成功、fail 0
- `配信対象の変更なし`
- diff check出力なし
- status出力なし

- [ ] **Step 3: コードレビューを依頼する**

`superpowers:requesting-code-review` を使い、reviewerへ次を渡す。

- Requirements: `docs/superpowers/specs/2026-07-30-deployment-safety-design.md`
- Plan: このファイル
- Base SHA: `origin/main`
- Head SHA: `HEAD`
- 重点: false negative、GitHub Actions式展開、Windows/Linux差、main保護前後のロックアウト

Critical・Important指摘は修正してStep 2を再実行する。

---

### Task 5: PR作成とCI実動確認

**Files:**
- External state: GitHub branch、Pull Request、Actions

**Interfaces:**
- Consumes: 検証済み作業branch
- Produces: GitHub上で成功した `node-test`

- [ ] **Step 1: branchをpushする**

```bash
git push -u origin HEAD
```

mainへpushしていないことを `git branch --show-current` で直前確認する。

- [ ] **Step 2: Pull Requestを作る**

```bash
gh pr create \
  --base main \
  --head docs/deployment-safety-design \
  --title "ci: add deployment safety checks" \
  --body "本番配信の安全装置として、Node 24の全テストとCACHE_NAME版上げ検査を追加します。アプリの配信対象ファイル、sw.js、現在のCACHE_NAMEは変更しません。問題があればこのPRのマージコミットをrevertできます。"
```

PR本文には目的、配信ファイル無変更、実行後の正確なテスト件数、CACHE_NAME検査の役割、ロールバックを書く。上記本文の「全テスト」を、Task 4で確認した件数を含む表現へ更新してから実行する。

- [ ] **Step 3: CIを監視する**

```bash
gh pr checks --watch
gh pr view --json statusCheckRollup,mergeable,headRefName,baseRefName
```

Expected: `node-test` success、base `main`、head `docs/deployment-safety-design`。

- [ ] **Step 4: PRをマージする**

CI成功とレビュー完了を確認後:

```bash
gh pr merge --merge --delete-branch=false
```

`main` への直接pushは使わない。

- [ ] **Step 5: main上のCIを確認する**

```bash
gh run list --branch main --workflow test --limit 3
RUN_ID=$(gh run list --branch main --workflow test --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

Expected: マージコミットに対する `node-test` success。

---

### Task 6: main保護の段階導入

**Files:**
- External state: GitHub branch protection
- Modify after verification: `HANDOFF.md`

**Interfaces:**
- Consumes: GitHub上で存在と成功を確認したstatus context `node-test`
- Produces: PR必須、`node-test`必須、管理者適用、force push/deletion禁止の `main`

- [ ] **Step 1: 現在の保護設定を保存する**

```bash
gh api repos/liftingmaster/liftingmaster.github.io/branches/main/protection
```

404なら「保護なし」として記録する。200ならJSONをローカルの一時ファイルへ保存し、作業終了後に削除する。

- [ ] **Step 2: 実際の必須チェック名を確認する**

```bash
gh api repos/liftingmaster/liftingmaster.github.io/commits/main/check-runs
```

Expected: check run名に `node-test` が存在し、conclusionが `success`。

- [ ] **Step 3: main保護を設定する**

Create an untracked temporary file `work/main-protection.json` with the exact JSON below. `work/` が無ければ作成し、作業終了時に `main-protection.json` だけを削除する。

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["node-test"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_conversation_resolution": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

Run:

```bash
gh api --method PUT \
  repos/liftingmaster/liftingmaster.github.io/branches/main/protection \
  --input work/main-protection.json
```

- [ ] **Step 4: 設定を読み戻して確認する**

```bash
gh api repos/liftingmaster/liftingmaster.github.io/branches/main/protection
```

確認項目:

- required status check `node-test`
- strict `true`
- enforce_admins `true`
- required pull request reviewsが有効
- force push/deletionが無効

- [ ] **Step 5: HANDOFF.mdの運用事実を更新する**

新しい短い文書専用branchを作り、事実表を次へ更新する。

- ブランチ保護: PR必須、管理者適用、force push/deletion禁止
- CI / Actions: `test` workflow、必須check `node-test`
- 作業の流れ: feature branch → PR → CI → merge。`git push origin main` を削除

文書branchでもCIが成功することを確認し、PR経由でマージする。アプリ配信対象は変更しない。

- [ ] **Step 6: 最終監査を行う**

```bash
gh api repos/liftingmaster/liftingmaster.github.io/branches/main/protection
gh run list --branch main --workflow test --limit 1
curl -s -H "Cache-Control: no-cache" https://liftingmaster.github.io/sw.js
```

Expected:

- main保護が設定値と一致
- 最新main CIがsuccess
- 本番 `sw.js` の `CACHE_NAME` は `liftingmaster-v14` のまま
