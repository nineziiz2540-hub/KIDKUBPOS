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
