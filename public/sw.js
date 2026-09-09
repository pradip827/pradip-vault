/**
 * ZeroVault - Zero-Knowledge Password Manager
 * Offline-First Service Worker (PWA)
 * 
 * Strategy:
 * - Navigation: Network-First with instant offline fallback to cached /index.html (SPA).
 * - Static Assets: Cache-First with Network fallback and dynamic caching for hashed bundles.
 * - External APIs: Network-Only (Google Drive, OAuth endpoints are never cached).
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `zerovault-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/icons/apple-touch-icon.png'
];

// Install: Pre-cache core shell resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch((err) => {
        console.warn('[SW] Pre-cache warning:', err);
        return self.skipWaiting();
      })
  );
});

// Activate: Delete obsolete cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => (name.startsWith('zerovault-') || name.startsWith('pradip-vault-')) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Message: Support SKIP_WAITING invocation from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// List of strictly allowed static file extensions
const STATIC_ASSET_EXTENSIONS = [
  '.js', '.mjs', '.css', '.woff', '.woff2', '.ttf', '.eot',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.webmanifest', '.wasm'
];

const STATIC_DESTINATIONS = ['script', 'style', 'font', 'image', 'manifest', 'worker'];

/**
 * Checks if a request targets sensitive API, auth, OAuth, drive, or vault data.
 * Sensitive requests MUST NEVER be cached.
 */
function isSensitiveRequest(url) {
  const origin = url.origin.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return (
    origin.includes('google') ||
    origin.includes('googleapis') ||
    pathname.startsWith('/api') ||
    pathname.includes('oauth') ||
    pathname.includes('drive') ||
    pathname.includes('vault') ||
    pathname.includes('credential') ||
    pathname.includes('session') ||
    pathname.includes('auth') ||
    pathname.includes('token')
  );
}

/**
 * Checks if a request matches the explicit static application asset allowlist.
 */
function isAllowedStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (isSensitiveRequest(url)) return false;

  // Browser destination match (scripts, styles, fonts, images)
  if (STATIC_DESTINATIONS.includes(request.destination)) {
    return true;
  }

  // Explicit extension match
  const pathname = url.pathname.toLowerCase();
  return STATIC_ASSET_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

// Fetch: Offline interception and intelligent routing
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Bypass non-http protocols (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strictly bypass and never cache sensitive requests (APIs, OAuth, Google Drive, tokens, vault data)
  if (isSensitiveRequest(url)) {
    return;
  }

  // 1. Navigation Requests: Network-first with SPA offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedIndex = await cache.match('/index.html') || await cache.match('/');
          if (cachedIndex) {
            return cachedIndex;
          }
          return new Response(
            '<!doctype html><html><head><title>ZeroVault - Offline</title></head><body style="background:#070a12;color:#f8fafc;font-family:sans-serif;text-align:center;padding:4rem 1rem;"><h1>Offline Mode</h1><p>ZeroVault is ready offline. Please reload to resume your session.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // 2. Static Assets (JS chunks, CSS, fonts, icons): Explicit Allowlist Only
  if (isAllowedStaticAsset(request, url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          // Cache successful responses for verified static assets only
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch((fetchError) => {
          // If offline and asset is not in cache
          return Promise.reject(fetchError);
        });
      })
    );
  }
});
