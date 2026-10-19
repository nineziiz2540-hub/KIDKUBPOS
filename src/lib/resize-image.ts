// Browser-only: shrinks a photo before upload. iPad camera photos are 2–6 MB, which is far
// more than a menu tile needs and more than a Server Action / Vercel request can carry.

export const PRODUCT_IMAGE_MAX_SIDE = 1200;
const JPEG_QUALITY = 0.85;

/**
 * Returns a JPEG no larger than `maxSide` on its longest edge. Small JPEG/PNG/WebP files that
 * already fit are returned untouched. If the browser can't decode the file, the original is
 * returned and the server's type/size checks decide.
 */
export async function resizeImageForUpload(file: File, maxSide = PRODUCT_IMAGE_MAX_SIDE): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // JPEG has no transparency: paint white so transparent PNGs don't turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return file;

  const base = file.name.replace(/\.[^.]*$/, "") || "image";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
