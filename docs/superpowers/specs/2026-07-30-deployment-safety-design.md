# 本番配信安全化 設計書

## 目的

`main` への push がそのまま子供向けPWAの本番配信になる現状で、アプリ本体の挙動を変えずに、誤配信と検証漏れを防ぐ。

## 対象範囲

- `HANDOFF.md` の確認済み事実誤認を修正する
- GitHub Actions で `node --test test/*.test.js` を自動実行する
- 配信対象ファイルを変更したのに `sw.js` の `CACHE_NAME` を変更していないPRを失敗させる
- CIが実際に成功した後、GitHubの `main` をPR経由・必須チェック付きにする

次は対象外とする。

- アプリ本体のJavaScript、CSS、HTML、画像の変更
- `sw.js` の配信ロジックや現在の `CACHE_NAME` の変更
- EXP計算と既知の二重クランプ問題の修正
- localStorageのデータやスキーマの変更
- 公開URL、リポジトリ名、GitHub Pages設定の変更

## 採用方式

安全装置を段階導入する。

1. 作業ブランチで文書、CI、CACHE_NAME検査を追加する
2. Pull Requestを作成し、CIがGitHub上で成功することを確認する
3. PRを `main` にマージする
4. マージ後、`main` のブランチ保護を有効化する

CIが存在しない状態で必須チェックを先に設定すると、チェック名の不一致などでマージ不能になる可能性がある。したがってブランチ保護はCI確認後に行う。

## 文書修正

`HANDOFF.md` では次を修正する。

1. 「最新コミット」を固定ハッシュで示さない。文書更新自体で直ちに陳腐化するため、確認コマンド `git log -1 --oneline` を案内する。
2. Service Workerは `ASSETS` だけを配信する、という説明を修正する。実装はキャッシュミス時にネットワーク取得し、成功した応答を動的にキャッシュする。
3. `ASSETS` 登録の目的を「インストール時に確実に事前キャッシュし、未取得状態でもオフライン動作させる」に統一する。

コードを正とし、文書以外の動作は変えない。

## CI

`.github/workflows/test.yml` を追加する。

- トリガー: `pull_request` と `push`
- 対象ブランチ: `main`
- 実行環境: `ubuntu-latest`
- Node.js: 24
- パッケージインストール: 実行しない（依存パッケージが存在しないため）
- テスト: `node --test test/*.test.js`
- CACHE_NAME検査: Pull Request時だけ実行する

Workflowとjobの名前はブランチ保護設定で参照するため、固定する。

- Workflow: `test`
- 必須job: `node-test`

## CACHE_NAME版上げ検査

検査ロジックは通常のNode.jsスクリプト `tools/check-cache-version.js` とし、GitHub Actions固有の処理に閉じ込めない。CIからは基準コミットと対象コミットを引数で渡す。

### 配信対象

`sw.js` の `ASSETS` に列挙される種類と一致させ、次を対象とする。

- `index.html`
- `manifest.json`
- `sw.js`
- `css/**`
- `js/**`
- `icons/**`

次は対象外とする。

- `HANDOFF.md`、`README.md`、`docs/**`
- `test/**`
- `tools/**`
- `.github/**`
- `package.json`

### 判定

基準コミットと対象コミットの差分で配信対象が変更された場合、両コミットの `sw.js` から `CACHE_NAME` を抽出する。

- 配信対象変更なし: 成功
- 配信対象変更あり、CACHE_NAMEが異なる: 成功
- 配信対象変更あり、CACHE_NAMEが同じ: 失敗
- `CACHE_NAME` が所定形式 `liftingmaster-v<整数>` でない: 失敗
- 比較対象のコミットを取得できない: 見逃さず失敗

この検査は「今回の変更に伴う版上げ」を確認する。既存の `test/invariants.test.js` が確認する形式・下限検査とは役割が異なる。

### テスト

`test/cacheVersionCheck.test.js` を先に作り、少なくとも次を固定する。

- 文書だけの変更は版上げ不要
- JavaScript変更＋同じCACHE_NAMEは失敗
- 画像追加＋CACHE_NAME変更は成功
- CSS削除も配信対象変更として扱う
- 不正なCACHE_NAMEは失敗
- 複数桁の版番号を扱える

Git操作そのものは薄いCLI層に限定し、判定関数は配列と文字列を入力とする純粋関数にして単体テストする。

## GitHubブランチ保護

CIが `main` 上でも成功したことを確認後、GitHub APIまたは `gh` CLIで次を設定する。

- `main` への変更はPull Request必須
- 必須ステータスチェック: `node-test`
- 必須チェックは最新コミットに対して成功が必要
- 管理者にも規則を適用する
- force pushを禁止
- branch deletionを禁止

初回導入ではレビュー人数の必須化は行わない。現在の運用人数が明示されておらず、一人運用の場合に自己マージ不能となるためである。必要なら後から追加する。

設定後に読み取りAPIで実値を再取得し、意図した保護が入ったことを確認する。

## エラー時の扱い

- ローカル420テストが失敗したらPRを作らない
- GitHub Actionsが失敗したらマージしない
- 必須チェック名がGitHub上の表示と一致しなければ、ブランチ保護を有効化しない
- ブランチ保護設定後に通常のPRがマージ不能なら、保護設定を読み直して原因を特定する。保護を解除して迂回しない
- mainへのpush、Pages設定変更、公開URL変更は本作業では行わない

## 完了条件

- `node --test test/*.test.js` が全件成功する
- CACHE_NAME検査の新規テストがRED→GREENで確認される
- 文書のみのPRではCACHE_NAME版上げを要求しない
- 配信対象変更＋版上げなしを検査が拒否する
- GitHub Actionsの `node-test` がPRとmainで成功する
- `main` がPR必須かつ `node-test` 必須になっていることをAPIで確認できる
- 本番アプリの配信ファイルには差分がない

## ロールバック

CI・検査コードに問題がある場合は、該当PRをrevertする。配信対象ファイルと `sw.js` を変更しないため、このrevertでPWAキャッシュ版を上げる必要はない。

ブランチ保護設定に誤りがある場合は、GitHub APIで直前の設定値へ戻す。設定変更前の値を保存し、復元可能な状態で実施する。
