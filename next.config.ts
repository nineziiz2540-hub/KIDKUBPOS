import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
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
};

export default withSerwist(nextConfig);
