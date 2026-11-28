// CoParent Hub service worker: keeps the app shell available, nothing else.
// Network-first for the shell so a deploy shows up on the next load; the cache is only a fallback.
// Never touches /api/*, /report or /ics/*: those are private, live data and must always come from the server.
const CACHE = 'coparent-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];
const SHELL_SET = new Set(SHELL);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('coparent-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isPrivate = (p) => p.startsWith('/api/') || p === '/report' || p.startsWith('/report/') || p.startsWith('/ics/') || p === '/healthz';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isPrivate(url.pathname)) return;
  // The single-page app lives at "/" (routes are in the #hash); other paths are only shell files.
  const key = req.mode === 'navigate' ? '/index.html' : url.pathname;
  if (!SHELL_SET.has(key)) return;
  event.respondWith(networkFirst(req, key));
});

async function networkFirst(req, key) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(key);
    if (hit) return hit;
    throw err;
  }
}
