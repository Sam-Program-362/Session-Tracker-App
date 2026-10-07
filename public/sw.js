// Session Tracker service worker.
//
// NOTE: this file is served verbatim from public/, so it must be plain
// JavaScript — no TypeScript syntax, or the browser rejects it at parse time
// and the worker never installs.
//
// Caching rules, in the order the fetch handler applies them:
//   - /api/ and /.well-known/  never touched; the browser talks to the network
//   - page navigations (HTML)  network-first, cached copy as the offline fallback
//   - /_next/static/*          cache-first (versioned, immutable filenames)
//   - the rest of the shell     stale-while-revalidate
//
// The cache name changes whenever the rules change, so a device that already
// has an older worker drops that cache on activate instead of serving it.

const CACHE = "session-tracker-shell-v3";

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

/** A navigation, or any GET that asks for HTML. */
function isHtmlRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.indexOf("text/html") !== -1;
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
// Activate: claim open pages, and clean up old caches so stale shell versions
// don't pile up.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
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

  // Page navigations: the network decides, so opening the app online always
  // shows the current build. The cached copy of that page — and failing that
  // the cached shell — is what keeps the app opening with no connection.
  if (isHtmlRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Next.js asset paths under _next/static/ are versioned and immutable.
  // Cache them on first use forever, keyed by their URL.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // The remaining static shell assets are cached on install: serve the cached
  // copy straight away and freshen it in the background.
  if (url.pathname === "/manifest.json" || url.pathname.startsWith("/icon-")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else goes to the network with a cache-aside pattern. If the
  // network is unavailable we serve the app shell so it at least opens.
  event.respondWith(networkFirstWithShellFallback(request));
});

// Network-first for navigations, cached copy as the offline fallback.
async function networkFirstNavigation(request) {
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
    return (
      shell ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

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

// Stale-while-revalidate for the static shell assets: fast, then freshen.
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
    const shell = await caches.match("/");
    return shell || new Response("Offline", { status: 503 });
  }
}
