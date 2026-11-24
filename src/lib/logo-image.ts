// Shop logo rules. Pure (no imports, no DOM) so it runs in plain Node tests.
// The image is used as the owner uploaded it: only white/transparent margins are trimmed.

export const LOGO_MAX_SIDE = 800;
export const LOGO_WORK_MAX_SIDE = 2000;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_HINT = "แนะนำไฟล์ PNG พื้นหลังโปร่งใส มีแค่โลโก้และชื่อร้าน";

type Size = { width: number; height: number };

function capped(width: number, height: number, maxSide: number): Size {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale === 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Size of the scratch canvas used to find the margins: never a full-size canvas (iPad limit ~16.7 MP). */
export function logoWorkSize(width: number, height: number): Size {
  return capped(width, height, LOGO_WORK_MAX_SIDE);
}

/** Size of the saved logo. */
export function logoOutputSize(width: number, height: number): Size {
  return capped(width, height, LOGO_MAX_SIDE);
}

/**
 * Bounding box of the non-empty pixels, padded by 2 % of the longer side and clamped to the image.
 * A pixel is empty when it is nearly transparent (alpha < 16) or nearly white (r, g, b all >= 245).
 * Null when the whole image is empty.
 */
export function logoTrimBox(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const empty =
        (data[i + 3] ?? 0) < 16 || ((data[i] ?? 0) >= 245 && (data[i + 1] ?? 0) >= 245 && (data[i + 2] ?? 0) >= 245);
      if (empty) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(0.02 * Math.max(width, height));
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + 1 + pad);
  const y1 = Math.min(height, maxY + 1 + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** `<tenant>/logo-<timestamp>.png`: storage policies only allow writes under the shop's own folder. */
export function logoPath(tenantId: string, now: number): string {
  return `${tenantId}/logo-${now}.png`;
}
