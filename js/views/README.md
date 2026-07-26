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
  （`updatePlayer` は保存するだけで、再描画はしない）
- 計算ロジックを画面に書かない。`js/core/` の関数を使う

## 後片付けの約束

`app.render()` が自動で消してくれるのは **`#app` の中身と、`document.body` 直下の `.nav`** だけ。
それ以外の場所に足したものは、画面自身が始末しなければ次の画面に持ち越される。

- `document` や `window` にイベントを登録したら、同じ画面の描き直しで二重登録にならないようにする
- `#app` の外にノードを足すなら、`.nav` と同じく「描く前に古いものを消す」形にする
- `#app` の中に足したノードとそのリスナーは、`root.innerHTML = ''` で消えるので気にしなくてよい
