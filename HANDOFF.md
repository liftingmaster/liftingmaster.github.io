# リフティングマスター 引き継ぎ書

> 注: `.superpowers/sdd/progress.md` は `.gitignore` されており、クローンすると消えます。
> 詳細はそちらにありますが、このファイルだけで文脈ゼロから開発を再開できるように書きました。

## ⚠ この文書の信頼度について（最初に読んでください）

**この引き継ぎ書は、書いた直後に2回の事実監査を受けています。**実コードと1行ずつ突き合わせた結果、
**1回目で18件、2回目で10件の事実誤認**が見つかり、すべて修正しました。見つかったものには
次のような「信じて作業すると壊れる」類が含まれていました。

- 「`prepare-art.js` は実行後に `incoming-art/` を自動削除する」→ **削除処理は存在しない**（元画像を失う）
- 「旧キャッシュの自動削除は入っていない」→ **`sw.js` に実装済み**（不要に触ると PWA を壊せる）
- 「開発ブランチなし・共有リモートなし・`main` で直接作業」→ **どちらも実在する**（本番配信ブランチへの直コミットを誘発）
- `displayStageOf` の写しが `player.chars[charId]`（**`player.chars` は配列**なので全画面が落ちる形）
- 「`test/invariants.test.js` が `CACHE_NAME` の版上げを見る」→ **見ていない**（上げ忘れても緑になる）

**3周目の監査は未実施です。**2回とも「修正が新しい誤りを生む」ことが起きているため、
**この文書の記述をコードの根拠として使わないでください。**必ず次のようにしてください。

1. 設計やコマンドの説明は、**必ず実コード・実ファイルで裏を取る**（本文には参照先の
   ファイル名と行番号を書いてあります）
2. **コードを写している箇所は特に疑う。**そのまま貼らず、実物を開いてコピーする
3. 食い違いを見つけたら、**コードを正とし、この文書を直す**

一方で **`node --test test/*.test.js` の既存420件は信頼できます。**本書の安全化作業で10件を追加し、
現在は432件です。文書と違って機械が守っています。
迷ったらテストを読むのが最短です。

---

## 何のアプリか

子供が毎日のリフティング（ボールを落とさない回数・ノーバウンドとワンバウンドの2モード）の最高回数を記録し、続けるほどキャラクターのレベルが上がって進化する Web アプリ（PWA）。記録はすべて端末の localStorage にだけ保存され、外部に送信されません。

**ユーザー**: 安部さんのお子さん。将来、他の子にも配る前提。

**公開 URL**: https://liftingmaster.github.io/

**リポジトリ**: GitHub Organization `liftingmaster` / `liftingmaster.github.io`
- 2026-07-29 に個人名を外して移転（旧 URL `https://ryoichiabe-svg.github.io/lifting-master/` は動かなくなった）
- localStorage はオリジン単位なので、移転時はバックアップして復元が必要（アプリ内で手順を用意）

---

## 動かし方

### テスト実行
```bash
node --test test/*.test.js
```

**重要**: Node 24 では `node --test test/`（ディレクトリ指定）は `MODULE_NOT_FOUND` になるため、**glob 展開必須**。

現在 **432テスト全通過** / `CACHE_NAME = liftingmaster-v14` / `SCHEMA_VERSION = 2`

### ローカル配信（開発時）
```bash
npm start
```

`tools/serve.js` で localhost:8123 を起動。`.claude/launch.json` が有効な環境では、npm start でブラウザペインが立ち上がり、実寸測定・スクリーンショット・クリック検査が可能。

### アイコン生成
```bash
node tools/make-icon.js
```

PWA アイコンを生成。

### キャラクター画像の準備

`README.md` の §キャラクターについて・画像化の手順 を参照。生成AIの出力画像を背景除去・縮小・512×512に整える。詳細は `tools/prepare-art.js` の冒頭コメント（1-22行）に記載。

---

## 現在の状態

- **最新コミット**: 固定値は書かない。`git log -1 --oneline` で実物を確認
- **デプロイ版**: `liftingmaster-v14`
- **テスト**: 432件全通過
- **本番稼働**: 安部さんのお子さんが毎日使用中

**キャラクター実装の進捗**:
- **御三家3体（ひのこ・しずく・はっぱ）**: 画像化完了・9枚が配信中
- **その他6体（ぴかり・もくも・きらら・がんろ・こおる・かげろ）**: SVG 生成のまま

---

## 変更を出すときの必須手順

### 1. 変更後に必ずテストを走らせる
```bash
npm test
```

全テストが通らないと push しない。

### 2. ファイルを増やしたら `sw.js` の `ASSETS` に追加する

**特に画像ファイル**は必須。`ASSETS` は Service Worker のインストール時に事前キャッシュする一覧です。
未登録でもオンライン時の初回アクセスではネットワークから取得され、成功すれば動的にキャッシュされますが、
未取得の端末ではオフライン表示が壊れます。初回から確実にオフライン利用できるよう必ず登録してください。

### 3. `CACHE_NAME` を必ず上げる

`sw.js` の `CACHE_NAME` を上げなければ、古いキャッシュが端末に配り続けられます。
```js
// sw.js
const CACHE_NAME = 'liftingmaster-v14'; // ← v15 に上げる
```

Service Worker はキャッシュ優先で動作するため、これを忘れると「直したのに直らない」状態になります。

### 4. 配信直前に突合を走らせる（オプション）

`sw.js` の `ASSETS` にファイルが漏れていないか確認するコマンド：
```bash
node -e "const fs=require('fs');const sw=fs.readFileSync('sw.js','utf8');const listed=new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]).filter(Boolean));const walk=(d,a=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory()){if(['node_modules','.git','.superpowers','.claude','incoming-art','test','tools','docs'].includes(e.name))continue;walk(p,a);}else a.push(p.replace('./',''));}return a;};const onDisk=walk('.').filter(f=>/\.(js|css|html|json|png)$/.test(f)&&f!=='package.json'&&f!=='sw.js');const missing=onDisk.filter(f=>!listed.has(f));console.log(missing.length?'漏れ: '+missing.join(', '):'漏れなし');"
```

### 5. 作業ブランチを push して Pull Request

作業ブランチを push して Pull Request を作り、`node-test` が成功してからマージします。
`main` への直接 push はしません。Pull Request のマージが GitHub Pages の本番反映になります。

---

## 最重要の設計（必ず読むこと）

次の5つは、触る前に理解しないと事故が起きます。

### A. EXP 保存則

**キャラの exp == 基準値 + そのキャラの全記録の `grantedExp` 合計**

この等式が常に成り立つことが、エラーの無い操作の前提です。

```js
// js/core/player.js の baseExpOf()
baseExp[c] = Math.max(0, c.exp − そのキャラの全記録の grantedExp 合計);
```

**テストで固定**: `test/expConservation.test.js` がこの等式を **クランプに当たった場合を除き常に成り立つ** ことを検証。赤くなったら保存則が壊れている危険信号。

### B. EXP 引き直しの計算方式（対称な before/after リプレイ）

記録を修正・削除したとき、その日の全キャラの EXP を引き直します。

**原則**:
1. リプレイ対象 = **その日全体（モード問わず）** の「新記録全部 ＋ 対象記録 R 自身」
   - EXP頭打ちルール（その日のEXPは「いちばん よかった きろく1つぶん」）により、グループの単位が
     「日付＋モード」から「その日全体」に広がった。モードを跨いで勝者を選定し直すため。
     **コード中のコメントはこれを `2026-07-28 EXP頭打ちルール` と書いている**
     （`js/core/player.js:343,531` / `js/core/gain.js:11`）。安部さんの判断日が 07-28、
     コミットが 07-29 なので、grep するときは `2026-07-28` を使うこと
2. 並び順は `createdAt` 昇順（同値は配列インデックスが第2キー）
3. **before / after で同じ `baseExp`・同じ並び順を使う**（対称性）
4. `exp = max(0, exp + (after − before))`
5. **クランプは最終結果に1回だけ**（before と after の両方にクランプがあると差分が消える）

**重要**: `createdAt` より後に作られた記録を `acc`（文脈）に入れてはいけません。入れると「当時のレベル」が変わり、そのレベルに依存する特性（はっぱのすくすく・きらら のきらめき）の再計算値まで変わります。

### C. その日のEXP は「いちばん よかった きろく1つぶん」だけ

2026-07-29 に「両モード同時記録」のルールが変わりました。**1日の EXP は、モード＋キャラをまたいで、いちばん多くもらったぶんだけ**。他の記録は進化条件・自己ベスト・連続日数には使われますが、EXP は 0 になります。

**例**:
- ぴかり（いなずま）がノーバウンド 10回 → +45 EXP（10×3×1.5倍）
- 同じぴかりがワンバウンド 30回 → +30 EXP（30×1×1倍）
- **その日のEXPは +45 だけ**。ワンバウンドのぶんは消える

比較は**EXP換算**（回数ではない）。ワンバウンド 50回でも最低50 EXPになるため、通常は EXP が高いモードが勝者になります。

### D. 進化ゲート（控えのキャラは進化しない）

現在、プレイヤーは複数のキャラを「育成中」「控え」で管理します。**控えのキャラは進化条件を満たしても進化しません**（絵も変わらない）。

**育成中に切り替えた瞬間に、進化条件を過去に満たしていた進化が演出で出ます**。

**実装**（`js/core/player.js:89-93`）:
```js
export function displayStageOf(player, charId) {
  const entry = charEntry(player, charId);
  const shown = clampedStages(entry.evolvedStages);
  return Math.min(2, Math.max(0, ...shown));
}
```

**重要な3点**:
1. `player.chars` は配列なので `player.chars[charId]` は `undefined` になります。必ず `charEntry()` で取得してください
2. `clampedStages()` が落とすのは **非数値だけ**（`Number.isFinite`）。`[1, true]` `[1, '2']`
   `[1, undefined]` `[1, NaN]` の類が対象。**`[1, 5]` の 5 は数値なので落ちません**
3. `[1, 5]` のような **範囲外の数値**を 0-2 に潰すのは `Math.min(2, Math.max(0, …))` 側。
   この2つは役割が違うので、片方を「もう一方が済ませているから不要」と外してはいけません

これを忘れると、手編集バックアップで範囲外の値が入り、home/party/dex/dexDetail が真っ白になります。

`stageOf`（潜在段階）と混ぜてはいけません。混ぜると控えのキャラの絵が勝手に進化します。

### E. ぴかり は「第1進化（だい1しんか）を実現したら解放」

2026-07-30 に `unlockLevel` から `unlockOnEvolvedStage: 1` に変更。

```js
// js/core/characters.js
pikari: {
  unlockLevel: null,           // Lv30 到達ではなく
  unlockOnEvolvedStage: 1,     // 誰かが stage:1 を実現したら
  ...
}
```

**判定は「実現した」進化で見ます**（`stageOf` という潜在段階ではない）。控えのキャラが条件を満たしただけでは解放されません。

**呼び出し側の必須変更**:
```js
// js/core/unlock.js:62
export function pendingUnlocks(maxLevelEver, ownedIds, maxEvolvedStageEver = 0) {
  // …
  if (c.unlockOnEvolvedStage && maxEvolvedStageEver >= c.unlockOnEvolvedStage) {
    // 進化由来のエントリを追加
  }
}
```

`pendingUnlocks()` は **第3引数 `maxEvolvedStageEver`** を受け取ります。これは「なかまの誰かが実現した進化段階の最大値」。**`player` のメソッドではなくモジュール関数**で、
`import { maxEvolvedStageEver } from '../core/player.js'` して `maxEvolvedStageEver(player)` と呼びます
（`js/core/player.js:50`。呼び出し例は `js/views/home.js:67` と `js/views/party.js:24`）。
`player.maxEvolvedStageEver()` と書くと `TypeError` で `render()` ごと落ち、画面が真っ白になります。渡し忘れると、ぴかりが解放されても「ホームにカード出ない」などの矛盾が起きます。`test/invariants.test.js` に機械検査あり。

---

## 踏んだ罠の一覧（25件）

### 罠 1 — `sw.js` の `ASSETS` にファイルを足し忘れる

**症状**: 画像を追加したのに、その画面がオフラインで壊れる。

**原因**: `ASSETS` リストのファイルだけがインストール時に事前キャッシュされます。リストに無いファイルは
オンラインで一度取得すれば動的にキャッシュされますが、未取得の端末ではオフラインで読み込めません。

**対策**: ファイルを増やしたら必ず `sw.js` の `ASSETS` に追加し、テスト・突合を走らせる。

### 罠 2 — `CACHE_NAME` の版を上げ忘れる

**症状**: 修正を出しても、端末に残った古いキャッシュが配り続けて変更が届かない。

**原因**: Service Worker はキャッシュ優先で動作するため、キャッシュ名を変えないと新しいキャッシュが作られません。

**対策**: `sw.js` の `CACHE_NAME` を必ず上げる（`liftingmaster-v13` → `liftingmaster-v14` など）。
`test/invariants.test.js` は形式と過去版への巻き戻しを検査し、Pull Request では
`tools/check-cache-version.js` が配信対象の変更に対する今回の版上げを検査します。

### 罠 3 — `createdAt` を `slice(11,16)` で表示

**症状**: 21時に記録した内容が「12:00」と表示される。**9時間のズレが出る**。

**原因**: `createdAt` は ISO8601 形式の UTC 時刻（`2026-07-30T12:00:00Z`）で保存され、`slice(11,16)` で `12:00` を抜き出すと UTC のまま表示されます。日本は UTC+9 なので9時間ずれます。

**対策**: `storage.js` の `validateRecord` で `createdAt` の形式まで検証し、ローカル時刻に変換してから表示。

### 罠 4 — `js/core/` に DOM を触るコードを置く

**症状**: テスト時に `document is not defined` で落ち、テスト戦略の前提が崩れる。

**原因**: `js/core/` は純粋関数の置き場。DOM は `js/views/` だけで扱う契約です。

**対策**: `js/core/` に DOM を置いてはいけない。うっかり混入した場合は `js/imgFallback.js` などの別ファイルに移動。`js/views/README.md` に「#app の外に足したものは画面自身が始末する」と書いてある。

### 罠 5 — 保存失敗時に成功したと表示する

**症状**: 容量が尽きた端末で「+30 EXP」「レベルアップ」「進化」まで見せるのに記録は残らない。

**原因**: `app.updatePlayer` は戻り値で成否を返すのに、呼び出し側が確認していない。

**対策**: `updatePlayer` の戻り値を常に確認し、失敗時は画面を戻す。最終レビュー後に `recordInput.js`・`party.js` など全画面で一括修正済み。

### 罠 6 — 「減額・削除ではEXPが増えない」は成立しない

**症状**: 記録を削除したのに EXP が増える（正例: はっぱ exp 4384・ワン64/ノー166/ノー192/ノー42 で、ノー166 を削除すると +78）。

**原因**: レベル依存特性（はっぱのすくすく「Lv20以下で×2」）が、取り消しによって ON に切り替わり、増額になる。

**対策**: 削除・減額でも進化判定を常時実行。「理由の説明つき」で EXP 増を画面に出す。この割り切りは仕様として固定。

### 罠 7 — 引く側だけ `max(0,…)` でクランプし足す側をしない

**症状**: EXP 負債が消えて無から生まれる（実例: +252）。

**原因**: before で `max(0, c.exp − grantedByChar)` とクランプして負債を捨てるのに、after の計算では同じ baseExp が使えず、そのズレぶんが新たに生まれる。

**対策**: before / after で同じ `baseExp`・同じ並び順を使い、クランプは最終結果に1回だけ。

### 罠 8 — 引く基準と足す基準を揃えないと

**症状**: 記録を削除したのに EXP が増える。旧実装では「旧600/新700で 300→2100」（回帰: `test/recordEditSymmetric.test.js:182` I3-c）。

**原因**: 削除時に「引く基準」と「足す基準」（並び順・`baseExp`）が違うと、
記録の `grantedExp` とキャラの `exp` の食い違いが積み上がります。

**対策**: before / after で同じ基準（並び順・baseExp）を使い、差分計算を対称にする。

### 罠 9 — 再計算の文脈にその記録より後の記録を入れると

**症状**: 回数を増やしたのに EXP が減る。

**原因**: 後続の記録がもたらす `personalBest`・`currentStreak` を先に評価されてから、対象記録のぶんが計算されると、当時と条件が変わります。

**対策**: リプレイ時の `acc`（文脈）には **そのメンバーより後に作られた記録を入れない**（`createdAt` で判定）。

### 罠 10 — グループ再計算は別のキャラのEXPも動かす

**症状**: 1体のキャラの記録を直したのに、兄弟キャラのレベルが下がる。

**原因**: EXP の総量は固定だから、1体が増えれば他は減ります。ただし `result` に動いたキャラすべてを載せないと、確認ダイアログにも進化演出にも出ません。

**対策**: `result.charChanges` に動いた全キャラを入れる（条件: `expDelta !== 0 || evolvedTo !== null`）。

### 罠 11 — 往復テストだけでは連続編集の欠陥を検出できない

**症状**: 「Aを直してからBを消す」のような連続操作で欠陥が出てもテストが通る。

**原因**: 往復テストは「戻す側の before も同じ再計算値になるので必ず元に戻る」という前提で、A→Bの後退を見ていません。

**対策**: 連続編集のテスト（`recordEditSymmetric.test.js` の S1〜S4）を追加。複数キャラの波及テストも必須。（※ファイル名は`symmetric`：対称性・相互性）

### 罠 12 — レベル依存特性を含まないテストは baseExp の欠陥を素通りする

**症状**: EXP 計算ロジックが間違っていても、ひのこやぴかりだけのテストでは見つかりません。

**原因**: はっぱ（すくすく「Lv20以下で×2」・`test/gain.test.js:54-58`）やきらら（きらめき「Lv50以上で×1.5」・`test/recordEditSymmetric.test.js:555`）の倍率は、取り消しの前後でレベルが線を跨ぐと値が変わります。これを組み込まないと欠陥が隠れます。

**対策**: EXP 引き直しのテストには**はっぱときらら両方を含める**。

### 罠 13 — view テスト0本

**症状**: `js/views/` の DOM 配線ロジックに欠陥が出ても、構造的に検出できません。

**原因**: view の欠陥は手動確認に頼りやすく、「まさか」のバグ（パスワード無視、クリック非応答）に気づかない。

**現状**: `test/helpers/minidom.js`（最小DOMシム）を新設し、実際の `render()` を駆動するテストが複数あります（`test/resultView.test.js` / `test/resultLevelDown.test.js` / `test/homeView.test.js` / `test/dexDetailView.test.js` / `test/partyUnlockView.test.js` / `test/restoreFromPlayerSelect.test.js`）。特にぴかり解放時の矛盾（進化カードが出ない）を回帰で固定。

**対策**: 今後も `js/views/` の変更時にテストを追加。DOM 配線の変更は極力避け、計算ロジックは `js/core/` に置く。

### 罠 14 — Service Worker のキャッシュが古い版を配り続ける

**症状**: 修正したのに効かない。ユーザーのブラウザに old キャッシュが残っている。

**原因**: 検証時に `CACHE_NAME` だけ上げても、端末が既に old キャッシュを持っていると、新しいキャッシュは作られず old が返されます。

**対策**: 旧キャッシュの自動削除は実装済み（`sw.js:64-70` の `activate` イベント。`CACHE_NAME` が変わったときに古いキャッシュを `caches.delete()` で削除）。ローカル検証時は `caches.delete()` と `sw.unregister()` を先に実行してから確認。

### 罠 15 — 移行に「別キーの印」を使うと、データの世代が判別できず穴が開く

**症状**: 世代情報をデータ外に置くと、バックアップJSONを手編集して版を偽ったときに移行が走らない（または何度も走る）。控えのキャラの絵が退化するか、復帰操作が出ない行き止まりになる。

**原因**: 外部キーで「version 1」「version 2」を区別しようとすると、別キーに0/1を立てただけのデータが来たとき、本当は古いのか新しいのかが判別できません。

**対策**: **世代情報は常にデータ自身（`SCHEMA_VERSION`）に持たせる**。`importJson` で JSON の `version` フィールド自体で判定。（実装済み: `js/storage.js` の `migrateToV2`）。

### 罠 16 — alpha=0 なのに RGB が灰色の画像がある

**症状**: 背景除去で、キャラの腹部（灰色）まで消えてしまう。`shizuku-1_png.png` で 1,050 画素（0.40%）が消失。

**原因**: 背景除去の `sampleBorder`/`score` が **alpha を見ず RGB だけ** で背景色を学習し、キャラ内部の同系色も背景判定に含める。

**対策**: 元画像の RGB チャンネルを目視確認。無彩色（グレースケール）が多ければ `--force-remove-bg` を通す前に慎重に扱う。

### 罠 17 — 数画素のゴミで切り出しの中心がずれる

**症状**: 背景除去後の中心がずれ、オフセット処理があればレイアウトが崩れる。`shizuku-2_png.png` で x=0 に alpha 39 の点が 2 つ残り、被写体範囲が 235px ずれるところだった。

**原因**: `opaqueBounds` がゴミの数画素を被写体と見なし、中心計算を狂わせます。

**対策**: `prepare-art.js` に下限を設定（辺の長さの 0.25% 未満の不透明画素は被写体と見なさない）。実装済み。

### 罠 18 — 「もとから透過済み」の判定を四隅 4 画素だけでやると穴が開く

**症状**: 「角丸マスク・ビネット・ぼかし背景」のように四隅は透明・背景は不透明の画像を渡すと、背景除去が丸ごと飛び、背景が残ったまま出力される。

**原因**: 四隅 4 画素だけ見て「透過済み」と判定すると、実は中身が入っているのに飛ばしてしまう。さらに **1 画素で判定が反転**（`shizuku-1_png.png` の (0,0) alpha を 0→1 にするだけで背景除去に入り、alpha>200 の画素が 960 個消える）。

**対策**: `transparencyProfile` に判定を広げ、**縁 1 リング全体の 99.5% 以上が alpha 0 かつ画像全体の 5% 以上が alpha 0** という AND 条件を使用。リング全体を母数にしたので 1〜2 画素のゴミでは反転しない。実装済み。

### 罠 19 — ツールを変えると過去の生成物が孤児になる

**症状**: `prepare-art.js` を改修（罠16-18）して、既存の `js/img/hinoko-*.png` を元画像から再生成しようとしても 1 つ以上が不一致になる。

**原因**: ツール改修の影響で、配信中のひのこ 3 枚中 2 枚が再現不可に。絵は劣化していないが、将来サイズ違いを作るときにひのこだけ食い違う。

**対策**: 改修後に過去の生成物も焼き直す。ひのこは焼き直して解消済み。

### 罠 20 — 「独立した第2実装」を名乗る逐語コピー

**症状**: `test/helpers/decode-png.js` が `tools/prepare-art.js` のデコーダと import 行と 1 フィールド以外 1 文字も違わないコピー。「独立実装なので相殺を防げる」という説明は成立しない。

**原因**: CLI を import すると `process.exit(2)` で落ちる」という理由（改修1で事実でなくなった）で複製。

**対策**: import を統一して嘘のコメントを削除。実装済み。

### 罠 21 — 「既存テストが落ちるから」を根拠に指示を退けた（最重）

**症状**: 安部さんの指示「`before` は常に保存されている `grantedExp` の合計」を受けて、実装者が「既存テスト 6 件が落ちる」と報告し、折衷案（`isLegacyDay` で「legacy の日は保存値・それ以外はリプレイ値」）に変更。その折衷案が **保存則を 184 件破った**。

**原因1**: 落ちるとされた 6 件のうち S1〜S4 は **テスト名からして「既知の残留・固定」** で、コメントに「割り切りの結果としてこの値になる（あるべきは◯◯）」と書かれていた。**あるべき値ではなく割り切りを固定したテスト** であり、指示を退ける根拠にならない。

**原因2**: 折衷案の仕組み。`settleDay` は記録の `grantedExp` を after のリプレイ値で無条件に上書きするのに、exp には after − before（before=リプレイ値）だけを足す。保存値とリプレイ値が食い違う日を触ると、差額が記録からだけ消えて exp に乗らない。

**修正**: `isLegacyDay` と `grantedBeforeByChar` の legacy 分岐を廃止。before は常に保存値（額が保存されていない旧データだけ before 側のリプレイ値で見積もる）。

**検証**: 同じ乱数列 20,000 セッションで、折衷案は 184 件、修正後は 0 件の保存則破れ。

**教訓**: テストが落ちたときは、まず **そのテストが「あるべき値」を固定しているのか「割り切り」を固定しているのか** を読むこと。後者なら指示を退ける根拠にならない。判断に迷ったら実装者が勝手に折衷せず、安部さんに上げる。

### 罠 22 — `baseExpOf` が 2 つ目のクランプを持っている（未修正・既知の制約）

**症状**: 別グループの削除で exp が 0 に張り付くと、引ききれなかった負債は記録されず、そこへ「保存値どおりに取り消す」before を当てると、切り捨てられた負債が逆に湧く（`recordEditSymmetric.test.js` の I5 で +87）。

**原因**: `baseExpOf` 自身が `Math.max(0, c.exp − grantedByChar)` というクランプを持つ。クランプ方針「クランプは最終結果に1回だけ」の例外。

**状態**: 塞いでいない。塞ぐには「クランプが効いた時点で、その日の保存 `grantedExp` も辻褄が合うよう落とす」など、**触っていない日の記録を勝手に書き換える** 必要があり、影響範囲が大きい。安部さんの判断待ち。

### 罠 23 — 記録の追加経路だけレベル低下を画面に出せていなかった

**症状**: ノーバウンド記録を追加したら、一覧でのレベル変化は「Lv24 → Lv23」と表示されるのに、追加画面の結果では「Lv24 → Lv24」と表示される。

**原因**: `js/views/result.js` が `if (r.levelAfter > r.levelBefore)` だけで、下がった場合の分岐が無い。`js/views/recordInput.js` の `commit()` が帰属先がないときに `levelBefore = levelAfter = levelAtStart` に固定していたため、実際に下がっていても画面は「変わらず」と主張。

**修正**: 帰属先がないときは最後のエントリに帰属させ、`result.js` に低下の分岐を追加。テストで実際の `render()`/`commit()` を駆動（`test/resultLevelDown.test.js`）。実装済み。

### 罠 24 — りょうほうのとき `levelBefore/levelAfter` と `charChanges` が粒度違い（潜在的）

**症状**: 将来起きうる。ノーバウンド10回＋ワンバウンド282回をりょうほうで入力したとき、結果エントリ0は `levelBefore:24, levelAfter:24` だが、`charChanges` には `{ charId:'happa', levelBefore:24, levelAfter:23 }` が入ることがある。

**原因**: `changeIndex` は「取引全体で言い直したレベル変化」（1つ）の帰属先だが、`charChanges` は各キャラ単位で1件ずつ返す（複数）。粒度が違う。

**現状**: `result.js` の `benchedLevelDrops` が育成中キャラを除外するので、壊れない。

**防ぎ方**: `charChanges` を「複合記録の全体レベルが最後のエントリから決まる」で再計算するか、`changeIndex` を「各 charChanges の帰属先」にするか。（場所: `js/views/recordInput.js` 345-347行）

### 罠 25 — まっさらな状態からバックアップを戻す入口が無かった

**症状**: 新しい端末・データを消したあと・公開URL移転のどれでも、プレイヤー0人だと「よみこむ」に入れない（`js/views/settings.js` が `if (!player) return app.go('playerSelect')`）。

**原因**: バックアップの「よみこむ」は設定画面の中にしかなく、プレイヤー0人では設定に入れない。

**顕在化**: 公開URL移転（`ryoichiabe-svg.github.io` → `liftingmaster.github.io`）。localStorage はオリジン単位なので新URL では記録0件。**必ず「はじめまして」画面から始まる**。

**修正**: `js/views/playerSelect.js` の `renderCreate` に「バックアップから もどす」を追加。**0人のときだけ出す**。確認ダイアログもパスワードゲートも出さない（0人なら消すものが無く、承認設定を持つプレイヤーも存在しない）。実装済み。

**教訓**: 「復元」の導線は、**復元が必要な状態=データが無い状態** から到達できないと意味がない。設定画面の奥に置くと、いちばん必要な場面で入れなくなる。

---

## やり残し

1. **キャラ画像の差し替え（6体残）** — 画像ができているのは**御三家3体・9枚だけ**
   （`js/img/` の中身と `sw.js` の `ASSETS` で確認できる）。
   **ぴかりはプロンプトだけ完成**（`docs/art-prompts/pikari.md`）で画像はまだ SVG のまま。
   もくも・きらら・がんろ・こおる・かげろ の5体はプロンプトも未作成
   - プロンプト作成 → `node tools/prepare-art.js` → 目視確認 → `js/svg/artManifest.js` 登録 → `sw.js` 追加 → `CACHE_NAME` 上げる
   - 残り6体で約3.6MB追加（現在1.8MB。合計約5MB）

2. **実機目視確認10項目** — ブラウザペインで数値測定済みの項目は **色・トーン・好み** の話だけが残

数値測定済み（本番反映済み）:
- モードボタン 78px ≤ 82px・1行・高さ60px
- 「つぎ ワンバウンド」 198.8px・1行
- 2体同時進化 つづける下端 698px ≤ 739px

残る好み・トーン判定（実機確認必須）:
   - モードボタン 13px が子供に読める大きさか
   - 「つぎ ワンバウンド」で次に何を入れるか伝わるか
   - 控えのキャラの絵が「進化前」のままであること自体の受け止め
   - 2体同時進化の compact 表示で嬉しさが薄れないか
   - 「けす」で進化演出が出ることの違和感
   - 「◯◯の EXPは かわらなかったよ」が祝いの場で水を差さないか
   - 兄弟キャラのレベル低下への納得感（理由説明で足りるか）
   - ホームのお知らせカード2枚の色バランス
   - ずかん詳細の「絵は第1進化・チェックリストは未達」の組み合わせ
   - 5体が画像化されたときの全体の見た目統一感

3. **base0 = exp − Σ grantedExp が負のセーブのチェック** — 通常は起きないが、手編集バックアップで発生可能

4. **js/views/ のテストが薄い** — `test/helpers/minidom.js` で実 `render()` を駆動しているのは
   **6本**（`resultView` / `resultLevelDown` / `homeView` / `dexDetailView` / `partyUnlockView` /
   `restoreFromPlayerSelect`）。うち homeView・dexDetailView・partyUnlockView の3本は
   2026-07-30 のぴかり解放で見つかった欠陥の回帰網なので消さないこと。
   **未着手は `logbook.js`・`approval.js`・`dex.js`・`settings.js`・`evolutionEffect.js`**

---

## 開発の作法（Codex での作業向け）

### テストファースト

テストを先に書く。今日の欠陥はほぼ全部「テストが緑のまま壊れていた」もの。罠12・21がその典型。

### 緑のテストを疑う

テストが落ちなければ正しいとは限らない。**「その性質を検査するテストが存在しない」ことに気づけるかが要**。

**例**: 全359件が緑のまま、EXPが無から生まれる／消える欠陥2件が通っていた。
原因は「キャラの exp == 基準 + そのキャラの `grantedExp` の合計」という**保存則そのものを
検査するテストが1本も無かった**こと。その穴を埋めたのが `test/expConservation.test.js`（現在10件）。
**この10件は今いちばん効く安全網なので、疑うのではなく増やす方向で扱うこと。**

### テストが落ちたときは設計方針を読む

**テストの主張を吟味する**。そのテストが：
- **「あるべき値」を固定しているのか** → テスト失敗は実装の欠陥
- **「割り切り」を固定しているのか** → テスト失敗は要件変更の機会

罠21がこれ。落ちていた6件は「既知の割り切り」を固定したテストで、指示を退ける根拠にならなかった。

### 同じ抜けを2回やったら機械検査を書く

罠3（UTC ずれ）は Task 21・23 で同じミスを2回やった → Task 23 の修正で `validateRecord` に形式検証を入れて根本を封鎖。

次に同じタイプの抜けが起きたら、`test/invariants.test.js` に機械検査を足す。

### 単体テストと往復テストの使い分け

- **単体テスト**: 正前進のケース（新記録・承認・進化）
- **往復テスト** (`recordEditSymmetric.test.js` の I 系): A → B → A に戻す
- **連続編集テスト** (`recordEditSymmetric.test.js` の S1〜S4): A → B → A でも C は変わる

往復テストだけではグループ再計算の欠陥が見つからない（罠11）。

### 「最悪の場合」を想定する

- 容量が尽きた端末（罠5）
- 手編集バックアップ（罠15）
- レベル依存特性とレベル閾値の交差（罠6・12）
- 連続操作と別グループの波及（罠10・11）

これらをテストに組み込んでから実装。

### `progress.md` は gitignore

`.superpowers/sdd/progress.md` は開発ログで、クローンすると消えます。**このリポジトリを初めて開く人は、このファイル（HANDOFF.md）だけ読んでください**。

---

## GitHub と配信のしくみ（作業前に必ず読む）

**いちばん大事なこと: `main` の更新は、そのまま本番反映です。**ステージング環境はありません。
Pull Request と必須CIはありますが、マージすると、お子さんが実際に使っているアプリが 1〜2分で入れ替わります。

### 事実（すべて `gh api` で確認した値）

```
リポジトリ      liftingmaster/liftingmaster.github.io
公開範囲        public          ← 無料の GitHub Pages を使う条件。private にすると配信が止まる
既定ブランチ    main
ブランチ保護    PR必須・管理者にも適用・node-test必須（strict）
                force push禁止・branch deletion禁止・承認人数0
CI / Actions    test workflow（必須check名: node-test）
                → Pull Request と main で全432テストを実行。PRでは CACHE_NAME の版上げも検査
Pages の設定    source: main の / （ルート）、build_type: legacy、HTTPS 強制、status: built
公開URL         https://liftingmaster.github.io/
gh CLI          ryoichiabe-svg で認証済み（keyring）。この repo に admin 権限あり
```

### repo 名を変えてはいけない

repo 名が `<Org名>.github.io` の形だからこそ、**パスなしのルート**で配信されています
（`liftingmaster.github.io/lifting-master/` のようなサブパスにならない）。
リネームすると URL が変わり、**localStorage はオリジン単位なのでお子さんの記録が見えなくなります**。
2026-07-29 の移転（`ryoichiabe-svg.github.io/lifting-master/` → 現URL）で実際にこれが起き、
バックアップの書き出しと読み込みで移しました。**旧URLはもう動きません。**

### 作業の流れ

```bash
git switch -c feature/なにをするか     # main で直接作業しない
# ...実装...
node --test test/*.test.js             # 全件通ることをローカルでも確認
# 配信対象を変えたら sw.js の CACHE_NAME を上げる（PRでも機械検査される）
git add -A && git commit
git push -u origin feature/なにをするか
gh pr create --base main               # node-test 成功を確認してからマージ
gh pr merge --merge                    # ← ここで本番が入れ替わる
```

### 反映されたかの確認

Pages のビルドに1〜2分かかります。**`CACHE_NAME` を見るのが確実**です。

```bash
curl -s -H 'Cache-Control: no-cache' https://liftingmaster.github.io/sw.js | grep -o "liftingmaster-v[0-9]*"
```

上げた版が返ってくれば反映済み。返らなければまだビルド中です。

### 元に戻したいとき

```bash
git revert <マージコミットのハッシュ> -m 1
git push origin main
```

`CACHE_NAME` も戻ることになりますが、**`test/invariants.test.js` に「過去の版へ戻していないこと」の
検査がある**ため、テストが落ちます。revert のあとは `CACHE_NAME` を「戻した先より大きい新しい版」に
付け替えてから push してください（例: v14 → revert → v15）。

### 未マージのブランチが残っている

```
feature/art-shizuku-happa / feature/daily-exp-cap /
feature/evolution-gating / feature/record-edit-and-dual-mode
```

いずれも `main` にマージ済みの作業ブランチで、残っているだけです。消しても構いません。

### public だが秘密情報は無い

コードとキャラ画像だけで、**お子さんの記録がここに入ることはありません**（記録は端末の
localStorage のみ）。親のパスワードもハッシュで端末内にしかありません。

---

## 環境

- **Node.js**: v24.18.0 以上（`node --test` 必須）
- **ブラウザ**: ローカル検証は Chrome。iOS/Android は実機確認が必要
- **依存パッケージ**: ゼロ。`npm install` は不要（`package.json` に dependencies が無い）

