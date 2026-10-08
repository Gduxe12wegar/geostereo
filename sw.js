/* GeoStereo Service Worker — オフライン対応 */
const CACHE = 'geostereo-v1';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

const TAILWIND_URL = 'https://cdn.tailwindcss.com';
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap';

/* キャッシュして再利用する外部ホスト (偏角APIなどは含めない) */
const CACHEABLE_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // アプリ本体
    await Promise.all(APP_FILES.map(f => cache.add(f).catch(() => {})));

    // Tailwind (スクリプト読み込み = no-cors)
    try {
      const res = await fetch(new Request(TAILWIND_URL, { mode: 'no-cors' }));
      await cache.put(TAILWIND_URL, res);
    } catch (_) {}

    // Googleフォント: CSS と、その中で参照されるフォントファイル
    try {
      const cssRes = await fetch(FONT_CSS_URL);
      const cssText = await cssRes.clone().text();
      await cache.put(FONT_CSS_URL, cssRes);
      const urls = [...cssText.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
      await Promise.all(urls.map(async (u) => {
        try { await cache.put(u, await fetch(u)); } catch (_) {}
      }));
    } catch (_) {}

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // 偏角APIなどは通常通りネットワークへ

  // キャッシュ優先 + 裏で更新 (stale-while-revalidate)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: false });

    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }

    const res = await network;
    if (res) return res;

    // 完全オフラインでページ遷移のとき: アプリ本体を返す
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('./');
      if (fallback) return fallback;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});
