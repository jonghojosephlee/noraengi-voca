const VERSION = '1.0.5-d0406fd17e';
const AUDIO_V = '8392960f37';
const SHELL = 'nv-shell-' + VERSION;
const DATA = 'nv-data';
const FONTS = 'nv-fonts';
const FILES = ['./', './index.html', './manifest.json', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('nv-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => caches.open(DATA))
      .then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => r.url.includes('/data/audio/') && !r.url.endsWith('v=' + AUDIO_V)).map(r => c.delete(r)))))
      .then(() => self.clients.claim())
  );
});

function fresh(request, cacheName, key) {   // network first (revalidating the HTTP cache), cached copy when offline or slow
  const network = fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(cacheName).then(c => c.put(key || request, copy)); }
    return res;
  });
  const slow = new Promise(resolve => setTimeout(resolve, 3500));
  return Promise.race([network, slow])
    .then(res => res || caches.match(key || request).then(hit => hit || network))
    .catch(() => caches.match(key || request));
}
function cached(request, cacheName) {   // cache first
  return caches.open(cacheName).then(c => c.match(request).then(hit => hit || fetch(request).then(res => {
    if (res.ok || res.type === 'opaque') c.put(request, res.clone());
    return res;
  })));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') event.respondWith(fresh(req, SHELL, './index.html'));
    else if (url.pathname.endsWith('/data/words.bin')) event.respondWith(fresh(req, DATA));
    else if (url.pathname.includes('/data/')) event.respondWith(cached(req, DATA));
    else event.respondWith(cached(req, SHELL));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cached(req, FONTS));
  }
});
