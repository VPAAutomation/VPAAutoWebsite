// Service worker: cache vỏ ứng dụng để mở được khi offline. Không cache API.
const CACHE = 'vpa-chamcong-v1';
const SHELL = ['./', './index.html', './app.js?v=1', './common.js', './style.css?v=1', './config.js?v=1',
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/admin/')) return;
  // network-first: luôn lấy bản mới khi có mạng, offline thì dùng cache
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: false }).then((r) => r || caches.match('./index.html')))
  );
});
