// Deliberately conservative: this is a parts/stock tracking app, so serving
// a cached (stale) quantity or a cached truck cap would be actively
// misleading. Every request goes to the network first; the cache only
// exists as a fallback so a spotty warehouse wifi connection doesn't throw a
// raw browser error page, and so the app shell (not the data) loads fast.

const CACHE_NAME = "nexus-inventory-shell-v2";
const SHELL_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

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

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isApi = url.pathname.startsWith("/api/");

  // API calls are never cached and never get a fallback: if the network is
  // down, the page's own fetch() must see a real failure so it can tell the
  // user, instead of receiving a cached HTML page it then fails to parse.
  if (!sameOrigin || isApi) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful, basic (non-redirected) responses for the
        // shell — a redirect to /login cached under "/" would trap signed-in
        // users on the login page while offline.
        if (response.ok && response.type === "basic" && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font-family:system-ui;padding:2rem\"><h1>You're offline</h1><p>Nexus Inventory needs a connection to load live stock counts. Reconnect and try again.</p></body>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        return Response.error();
      })
  );
});
