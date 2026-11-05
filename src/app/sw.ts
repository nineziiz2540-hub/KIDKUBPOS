import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // The POS heartbeat must reach the network or fail: defaultCache's NetworkFirst for /api/
    // would answer an offline check from the cache and the "internet down" bar would never show.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/api/heartbeat",
      handler: new NetworkOnly(),
    },
    // The POS page itself must open with no internet. Its own cache (no expiration, so it is never
    // evicted) and NetworkFirst with a 4s timeout so a dead connection falls back fast. A redirect
    // (signed-out -> /login) or non-200 is never stored, so the cache cannot hold the login page.
    {
      matcher: ({ url, sameOrigin, request }) =>
        sameOrigin && request.mode === "navigate" && url.pathname === "/pos",
      handler: new NetworkFirst({
        cacheName: "pos-shell",
        networkTimeoutSeconds: 4,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) =>
              response.status === 200 && !response.redirected ? response : null,
          },
        ],
      }),
    },
    // Every other page: network only. defaultCache would cache each visited page and serve it
    // offline after a deploy, pointing at purged chunks (Next's error screen). A failed navigation
    // instead goes to the offline.html fallback below.
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin && request.mode === "navigate" && url.pathname !== "/pos",
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  // Other pages show a static Thai page when offline and uncached.
  fallbacks: {
    entries: [
      {
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// A new build changes every chunk hash and Serwist's own activate step drops the old build's
// precache, so a /pos page cached by the old build would reference chunks that no longer exist
// and render Next's error screen offline. Re-fetch /pos from the new build when this worker
// activates (alongside Serwist's own activate listener). A redirect (signed out, sent to /login)
// or a 4xx removes the stale entry: the offline page is better than a page with missing chunks.
// A 5xx, a timeout or being offline leaves the cache as is.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const key = new URL("/pos", self.location.origin).href;
      let response: Response;
      try {
        response = await fetch(key, {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "text/html" },
          // While this worker is activating, fetches from the controlled tab wait for it: bound it.
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Offline or timed out: leave the cache as is.
        return;
      }
      const cache = await caches.open("pos-shell");
      if (response.status === 200 && !response.redirected) {
        await cache.put(key, response);
      } else if (response.redirected || (response.status >= 400 && response.status < 500)) {
        await cache.delete(key);
      }
      // 5xx: keep the entry, a transient error must not discard a page that may be current.
    })(),
  );
});
