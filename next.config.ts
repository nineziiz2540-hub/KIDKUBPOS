import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Product images are capped at 5MB (MAX_PRODUCT_IMAGE_BYTES); leave room for the
      // multipart envelope. Photos are normally resized on the device well below this.
      bodySizeLimit: "6mb",
    },
  },
};

export default withSerwist(nextConfig);
