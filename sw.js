/* TypeTalk service worker
 * - Precache the app shell (relative URLs so it works under a subpath such as GitHub Pages /repo/)
 * - Same-origin GET: stale-while-revalidate
 * - Cross-origin GET: network-first; cached fallback only for fonts
 * - Never caches non-200 / opaque API responses; ignores non-GET requests
 */

const CACHE_NAME = 'typetalk-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './css/styles.css',
  './css/keyboard.css',
  './css/typing.css',
  './css/dictation.css',
  './css/speaking.css',
  './css/shadowing.css',
  './css/results.css',
  './css/dashboard.css',
  './js/app.js',
  './js/ui.js',
  './js/storage.js',
  './js/settings.js',
  './js/stats.js',
  './js/milestones.js',
  './js/textProvider.js',
  './js/speech.js',
  './js/audio.js',
  './js/keyboard.js',
  './js/charts.js',
  './js/results.js',
  './js/modes/typing.js',
  './js/modes/dictation.js',
  './js/modes/speaking.js',
  './js/modes/shadowing.js',
  './js/modes/dashboard.js',
  './data/texts.json'
];

/**
 * Cache every shell URL individually so a single missing file does not fail install.
 * @param {Cache} cache
 * @returns {Promise<void>}
 */
function precacheShell(cache) {
  return Promise.all(
    APP_SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
        console.warn('[sw] precache skipped:', url, err && err.message);
      })
    )
  ).then(() => undefined);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(precacheShell)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('typetalk-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * @param {Response} response
 * @returns {boolean} true when the response is a real, complete 200 that is safe to cache
 */
function isCacheable(response) {
  return !!response && response.ok && response.status === 200 && response.type !== 'opaque';
}

/**
 * Stale-while-revalidate for same-origin assets.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  const networkPromise = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Refresh in the background; the browser keeps the SW alive long enough for a short fetch.
    networkPromise.catch(() => {});
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  // Offline and nothing cached: for navigations fall back to the shell index.
  if (request.mode === 'navigate') {
    const shell = (await cache.match('./index.html')) || (await cache.match('./'));
    if (shell) return shell;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}

/**
 * Network-first for cross-origin requests. Fonts are cached as a fallback; API responses never are.
 * @param {Request} request
 * @param {boolean} isFont
 * @returns {Promise<Response>}
 */
async function networkFirst(request, isFont) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isFont && isCacheable(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    if (isFont) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  const isFont = FONT_HOSTS.includes(url.hostname) || request.destination === 'font';
  event.respondWith(networkFirst(request, isFont));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
