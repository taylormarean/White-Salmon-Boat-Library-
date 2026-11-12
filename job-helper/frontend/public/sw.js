/*
 * Next Chapter service worker — keeps the app shell available offline so the
 * home-screen app opens instantly. It never caches anything under /api/
 * (her data always comes fresh from the server) and never touches non-GET
 * requests. Bump VERSION to force every phone to drop its old cache.
 */
const VERSION = 'v1';
const SHELL_CACHE = `nc-shell-${VERSION}`;
const ASSET_CACHE = `nc-assets-${VERSION}`;

// '/' is index.html. (Not '/index.html' itself: Cloudflare redirects that to '/',
// and a redirected response can't be used to answer a page load.)
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/register-sw.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // cache: 'reload' bypasses the browser's HTTP cache so we store fresh copies.
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            fetch(new Request(url, { cache: 'reload' })).then((res) => {
              if (!res.ok) throw new Error(`precache failed for ${url}: ${res.status}`);
              return clean(res).then((copy) => cache.put(url, copy));
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('nc-') && !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POST/PUT/DELETE etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // other sites: browser default
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return; // always network, never cached
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(req, event));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
  // Anything else: let the browser handle it normally.
});

// Pages: try the network (so updates show up right away); if offline, use the cached app shell.
async function networkFirstPage(req) {
  try {
    const res = await fetch(req);
    const type = res.headers.get('content-type') || '';
    if (res.ok && res.type === 'basic' && type.includes('text/html')) {
      // Every page of this single-page app is the same index.html, so keep the latest copy as the shell.
      const copy = await clean(res.clone());
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', copy);
    }
    return res;
  } catch (err) {
    const cached = await caches.match('/', { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw err;
  }
}

// Rebuild a response without its "redirected" flag (browsers refuse redirected responses for page loads).
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Vite's hashed files (/assets/index-abc123.js) never change, so serve from cache and refresh in the background.
async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || Response.error();
}
