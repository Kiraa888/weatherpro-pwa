const CACHE_NAME = 'premium-weather-v2';
const STATIC_ASSETS = [
    './', 
    './index.html', 
    './style.css', 
    './app.js', 
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(cacheNames.map((cache) => { 
                if (cache !== CACHE_NAME) return caches.delete(cache); 
            }));
        })
    );
});

// Stale-While-Revalidate Strategy
self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('api.openweathermap.org')) {
        e.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(e.request).then((cachedResponse) => {
                    const fetchPromise = fetch(e.request).then((networkResponse) => {
                        cache.put(e.request, networkResponse.clone());
                        return networkResponse;
                    });
                    // Return cached data immediately if exists, otherwise wait for network
                    return cachedResponse || fetchPromise;
                });
            })
        );
    } else {
        // Cache first for static assets
        e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
    }
});
