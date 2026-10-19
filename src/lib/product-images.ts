// Product image rules. Pure (no imports) so it runs in plain Node tests.
// The bucket enforces the same type and size limits (migration 20261019120000).

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

/** MIME type → file extension. The extension never comes from the user's filename. */
export const PRODUCT_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** `<tenant>/<product>-<timestamp>.<ext>`: storage policies only allow writes under the shop's own folder. */
export function productImagePath(tenantId: string, productId: string, mime: string, now: number): string {
  return `${tenantId}/${productId}-${now}.${PRODUCT_IMAGE_TYPES[mime]}`;
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;

/** The object path inside the bucket for a public URL we generated, or null for anything else. */
export function storagePathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_PREFIX);
  if (i === -1) return null;
  const path = url.slice(i + PUBLIC_PREFIX.length);
  if (path === "") return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
