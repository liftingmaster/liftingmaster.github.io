# 画面モジュールの約束

各ファイルは次の形にする。

```js
export function register(app) {
  app.registerScreen('screenName', render);
}

function render(root, app, params) {
  // root の中身を組み立てる。イベント登録もここで行う。
}
```

- 画面は自前の状態を持たない。必要な値は `app.state` から毎回導出する
- データの更新は `app.updatePlayer(player => 新しいplayer)` を通す（保存まで面倒を見てくれる）
- 更新後の再描画は呼び出し側で `app.go(...)` または `app.render()` を呼ぶ
- 計算ロジックを画面に書かない。`js/core/` の関数を使う
