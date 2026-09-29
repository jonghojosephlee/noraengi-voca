const VERSION = '1.0.10-a907d2d2ca';
const P = 'nv';                // this app's cache names (초록 cv-, 노랭이 nv-: both apps share one origin)
const AUDIO_KEEP = ["d01.bin?v=5e5baa9768", "d02.bin?v=9c7649ce29", "d03.bin?v=4e1c70ba21", "d04.bin?v=450dcee627", "d05.bin?v=1d409e23cb", "x01.bin?v=96fb35916f", "x02.bin?v=b99e976b1d", "x03.bin?v=c00332a52f", "x04.bin?v=03d6fea2a0", "x05.bin?v=94eb9bd21d"];    // the current audio packs of each Day ("d01.bin?v=<hash>", examples "x01.bin?v=<hash>")
const OLD = {"prefixes": [], "names": []};                  // caches an older build of this app left behind
const SHELL = P + '-shell-' + VERSION;
const DATA = P + '-data';
const FONTS = P + '-fonts';
const FILES = ['./', './index.html', './manifest.json', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith(P + '-shell-') && k !== SHELL) || OLD.prefixes.some(x => k.startsWith(x)) || OLD.names.includes(k)).map(k => caches.delete(k))))
      .then(() => caches.open(DATA))
      .then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => r.url.includes('/data/audio/') && !AUDIO_KEEP.some(k => r.url.endsWith('/' + k))).map(r => c.delete(r)))))   // only Days whose pack changed are fetched again
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

// study reminders from the voca-sync workflow: {title, body, url, tag}
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(self.registration.showNotification(m.title || '공부할 시간이에요', { body: m.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: m.tag || 'study', data: { url: m.url || './' } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow ? self.clients.openWindow('./') : null;
  }));
});

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
