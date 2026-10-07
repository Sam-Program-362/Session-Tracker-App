// Session Tracker service worker.
//
// NOTE: this file is served verbatim from public/, so it must be plain
// JavaScript — no TypeScript syntax, or the browser rejects it at parse time
// and the worker never installs.

const CACHE = "session-tracker-shell-v2";

// Assets that make up the app shell. Keep this in sync with whatever you
// want available when the device is fully offline.
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];

// Never touched by this worker: no interception and no cache entry.
//  - /api/          auth and sync are live data (and sync is a POST), so a
//                   cached copy would freeze the session or replay old rows.
//  - /.well-known/  Android asks Google for assetlinks.json; pinning an
//                   old answer would break app-link verification.
function isNeverCached(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/.well-known/");
}

// ---------------------------------------------------------------------------
// Install: take control immediately and precache the static shell.
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate right away so the new worker can start serving responses.
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate: clean up old caches so stale shell versions don't pile up.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch: serve the shell from cache first, falling back to the network.
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-GET requests and third-party origins (analytics, fonts from
  // Google, etc.). We only cache what we ship.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Hand these straight to the browser: never cached, never served stale.
  if (isNeverCached(url.pathname)) {
    return;
  }

  // Next.js asset paths under _next/static/ are versioned and immutable.
  // Cache them on first use forever, keyed by their URL.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // The app shell (HTML) and our static public assets are cached on install.
  // Serve them from cache, falling back to the network when online.
  if (
    url.pathname === "/" ||
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/icon-")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else goes to the network with a cache-aside pattern. If the
  // network is unavailable we serve the app shell so it at least opens.
  event.respondWith(networkFirstWithShellFallback(request));
});

// Cache-first for immutable Next.js static assets.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response("Offline", { status: 503 });
  }
}

// Stale-while-revalidate for the shell and icons: fast, then freshen.
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  });
  return cached || fetchPromise;
}

// Network-first for other GETs, with the app shell as the offline fallback.
async function networkFirstWithShellFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Awaited, because caches.match resolves to undefined when it misses and
    // respondWith(undefined) would throw.
    const shell = await caches.match("/");
    return shell || new Response("Offline", { status: 503 });
  }
}
