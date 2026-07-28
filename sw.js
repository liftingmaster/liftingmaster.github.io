/**
 * オフラインで動かすためのキャッシュ。
 * ファイルを変えたら CACHE_NAME の版を上げること（古いキャッシュが残るため）。
 */
const CACHE_NAME = 'liftingmaster-v10';

// ファイルを増やしたら ASSETS にも足すこと。足し忘れるとオフラインでその画面が壊れる。
// 突合方法は README の「配布」の節を参照

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/storage.js',
  './js/crypto.js',
  './js/core/exp.js',
  './js/core/characters.js',
  './js/core/stats.js',
  './js/core/streak.js',
  './js/core/abilities.js',
  './js/core/backupPrompt.js',
  './js/core/gain.js',
  './js/core/evolution.js',
  './js/core/unlock.js',
  './js/core/player.js',
  './js/imgFallback.js',
  './js/svg/character.js',
  './js/svg/artManifest.js',
  './js/svg/chart.js',
  './js/img/hinoko-0.png',
  './js/img/hinoko-1.png',
  './js/img/hinoko-2.png',
  './js/img/shizuku-0.png',
  './js/img/shizuku-1.png',
  './js/img/shizuku-2.png',
  './js/img/happa-0.png',
  './js/img/happa-1.png',
  './js/img/happa-2.png',
  './js/views/playerSelect.js',
  './js/views/home.js',
  './js/views/recordInput.js',
  './js/views/result.js',
  './js/views/party.js',
  './js/views/dex.js',
  './js/views/dexDetail.js',
  './js/views/logbook.js',
  './js/views/settings.js',
  './js/views/approval.js',
  './js/views/passwordGate.js',
  './js/views/evolutionEffect.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// キャッシュ優先。ネットワークは更新時のみ使う
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      const copy = res.clone();
      // 保存に失敗しても返す応答には影響しない。握りつぶさないと未処理の拒否が出る
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
      // キャッシュ照会そのものが失敗したときも、アプリの入口だけは返す
      .catch(() => caches.match('./index.html')),
  );
});
