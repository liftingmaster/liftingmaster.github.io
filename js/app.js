import { load, save, STORAGE_KEY } from './storage.js';
import { installImgFallback } from './core/imgFallback.js';

const SCREENS = {};   // 名前 -> render 関数（各 view が登録する）
const root = document.getElementById('app');

/** localStorage が使えるか確かめる */
function storageAvailable() {
  try {
    const probe = `${STORAGE_KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const app = {
  state: null,
  screen: 'playerSelect',
  params: {},

  today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  now() {
    return new Date().toISOString();
  },

  newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },

  currentPlayer() {
    if (!this.state || !this.state.activePlayerId) return null;
    return this.state.players.find((p) => p.id === this.state.activePlayerId) || null;
  },

  /**
   * プレイヤーを更新して保存する。保存できたかを呼び出し側へ返す（再描画はしない）。
   * 保存に失敗したらメモリ上も元に戻す。戻さないと、画面には反映されたのに
   * ディスクには無い状態が残り、あとで別の保存が成功したときに黙って確定してしまう
   */
  updatePlayer(fn) {
    const current = this.currentPlayer();
    if (!current) return false;
    const previousPlayers = this.state.players;
    const next = fn(current);
    this.state.players = this.state.players.map((p) => (p.id === next.id ? next : p));
    if (this.persist()) return true;
    this.state.players = previousPlayers;
    return false;
  },

  persist() {
    const r = save(localStorage, this.state);
    if (!r.ok) this.toast('ほぞんできませんでした');
    return r.ok;
  },

  go(screen, params = {}) {
    this.screen = screen;
    this.params = params;
    this.render();
  },

  render() {
    const view = SCREENS[this.screen];
    // 画面は #app の外（document.body）にもナビを足すので、描き直す前に必ず消す。
    // これを忘れると画面を移動するたびにナビが積み重なる
    document.querySelectorAll('.nav').forEach((el) => el.remove());
    if (!view) {
      root.innerHTML = `<div class="card">がめんが みつかりません (${this.screen})</div>`;
      return;
    }
    root.innerHTML = '';
    view(root, this, this.params);
    window.scrollTo(0, 0);
  },

  toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  },

  registerScreen(name, renderFn) {
    SCREENS[name] = renderFn;
  },
};

/** 下部ナビを描く。画面側から呼ぶ */
export function renderNav(current, appRef) {
  const nav = document.createElement('div');
  nav.className = 'nav';
  const items = [
    ['home', 'ホーム'],
    ['party', 'なかま'],
    ['dex', 'ずかん'],
    ['logbook', 'きろく'],
    ['settings', 'せってい'],
  ];
  for (const [name, label] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    if (name === current) b.className = 'on';
    b.addEventListener('click', () => appRef.go(name));
    nav.appendChild(b);
  }
  document.body.appendChild(nav);
}

/** 起動 */
async function boot() {
  if (!storageAvailable()) {
    root.innerHTML = `<div class="card">
      <h2>このブラウザでは つかえません</h2>
      <p>きろくを ほぞんできない せっていに なっています。プライベートモードを やめて ひらいてください。</p>
    </div>`;
    return;
  }

  const loaded = load(localStorage);
  app.state = loaded.state;

  // 画面モジュールを読み込んで登録する
  const views = await Promise.all([
    import('./views/playerSelect.js'),
    import('./views/home.js'),
    import('./views/recordInput.js'),
    import('./views/result.js'),
    import('./views/party.js'),
    import('./views/dex.js'),
    import('./views/dexDetail.js'),
    import('./views/logbook.js'),
    import('./views/settings.js'),
    import('./views/approval.js'),
  ]);
  for (const v of views) v.register(app);

  if (loaded.recovered) {
    app.toast('データが よめなかったので さいしょから はじめます');
  }

  app.go(app.currentPlayer() ? 'home' : 'playerSelect');

  // 画像キャラ（Task 28〜）の読み込み失敗をSVGへ描き直すフォールバック。
  // 1回だけ登録すれば、以後アプリが描く全ての <img> をまとめて拾う
  installImgFallback();

  // Service Worker（file:// では登録できないので握りつぶす）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン対応なしで動く */ });
  }
}

boot();
