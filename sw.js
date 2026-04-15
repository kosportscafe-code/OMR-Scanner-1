const CACHE_NAME = 'omr-scanner-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './lib/opencv.js',
  './lib/lucide.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install event - caching assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch event - Cache-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cache hit, else fetch from network
      return response || fetch(event.request).then((fetchResponse) => {
        // Optional: Cache new requests on the fly if needed
        return fetchResponse;
      });
    }).catch(() => {
      // Fallback if both fail (offline and not in cache)
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
