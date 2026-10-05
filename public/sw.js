/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE = "session-tracker-shell-v1";
// Assets that make up the app shell. Keep this in sync with whatever you
// want available when the device is fully offline.
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  // Next.js serves JS/CSS from _next/static. We precache the entrypoint
  // chunk by its stable filename at build time; see install event below.
];

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
// Navigation requests for the app shell use an offline fallback page.
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests and third-party origins (analytics, fonts from
  // Google, etc.). We only cache what we ship.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
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

  // Everything else (e.g. runtime data that doesn't exist here) goes to the
  // network with a cache-aside pattern. If the network is unavailable we
  // return the app shell so the app at least opens offline.
  event.respondWith(networkFirstWithShellFallback(request));
});

// Cache-first for immutable Next.js static assets.
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

// Stale-while-revalidate for the shell and icons: fast, then freshen.
async function staleWhileRevalidate(request: Request): Promise<Response> {
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
async function networkFirstWithShellFallback(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fall back to the app shell so the app still opens offline.
    return caches.match("/") || new Response("Offline", { status: 503 });
  }
}
