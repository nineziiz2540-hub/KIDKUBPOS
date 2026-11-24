import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Serwist's default (true) reloads every page whenever the browser goes back online: a Wi-Fi blip
  // on the iPad wiped the POS cart in progress. Pages handle reconnecting themselves (the POS
  // heartbeat in src/components/pos/use-heartbeat.ts).
  reloadOnOnline: false,
  // Customer receipt pages (/r/) must not install the POS service worker. RegisterServiceWorker in the
  // root layout registers it on every other page, the same as before.
  register: false,
});

const nextConfig: NextConfig = {
  env: {
    // See src/lib/build-version.ts: one value per deployment, the same on server and client.
    NEXT_PUBLIC_BUILD_VERSION:
      process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  experimental: {
    serverActions: {
      // Product images are capped at 5MB (MAX_PRODUCT_IMAGE_BYTES); leave room for the
      // multipart envelope. Photos are normally resized on the device well below this.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        // The public customer receipt (no login): never indexed, never leaks its URL as a referrer.
        source: "/r/:token*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
