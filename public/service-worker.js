const CACHE_NAME = "mobile-studio-ai-static-v2";
const ASSETS = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  // Do not cache authenticated API responses, OAuth routes, or non-GET requests.
  if (req.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (ASSETS.includes(url.pathname)) {
    // Network-first so updated HTML/JS/CSS are picked up promptly; the cache
    // is only a fallback when the network is unreachable.
    event.respondWith(
      fetch(req).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return response;
      }).catch(() =>
        caches.match(req).then(cached => cached || new Response("Offline", { status: 503 }))
      )
    );
  }
});
