// Deliberately conservative: this is a parts/stock tracking app, so serving
// a cached (stale) quantity or a cached truck cap would be actively
// misleading. Every request goes to the network first; the cache only
// exists as a fallback so a spotty warehouse wifi connection doesn't throw a
// raw browser error page, and so the app shell (not the data) loads fast.

const CACHE_NAME = "nexus-inventory-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache same-origin, successful responses for the shell —
        // never API routes, so nothing dynamic gets served stale.
        if (response.ok && new URL(request.url).origin === self.location.origin && !request.url.includes("/api/")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/")))
  );
});
