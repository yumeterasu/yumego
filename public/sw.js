// Yumego service worker
// Strategy:
// - Navigations (HTML pages): network-first, falling back to the last
//   cached copy of that page when offline (so the app shell still opens).
// - Static assets (_next/static, icons, etc.): cache-first, since their
//   filenames are content-hashed and never change.
// - GET API calls (e.g. /api/students): stale-while-revalidate, so the
//   last known student list still shows up when offline.
// - Non-GET requests (POST /api/attendance, /api/students, /api/login):
//   never intercepted here — the app itself queues failed submissions
//   and retries them (see src/lib/offlineQueue.ts).

const CACHE_NAME = "yumego-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["/manifest.json", "/icon-192.png", "/icon-512.png"])
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return; // let the app handle writes/queueing
  if (!request.url.startsWith(self.location.origin)) return; // same-origin only

  const url = new URL(request.url);

  // Never cache auth-sensitive endpoints; let them hit the network directly
  // so the proxy's login check always runs.
  if (url.pathname === "/api/login" || url.pathname === "/login") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      "<html><body style='font-family:sans-serif;padding:2rem;text-align:center'>" +
        "<h1>オフラインです</h1><p>インターネット接続を確認してください。</p>" +
        "</body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  cache.put(request, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((fresh) => {
      cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);

  return cached || (await networkPromise) || new Response("[]", { status: 200 });
}
