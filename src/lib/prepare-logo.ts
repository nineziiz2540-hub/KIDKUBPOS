// Browser-only: trims the white/transparent margins of a logo and shrinks it before upload.
// The colours are never changed and no background is removed.
import { LOGO_MAX_BYTES, logoOutputSize, logoTrimBox, logoWorkSize } from "./logo-image";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const UNREADABLE = "อ่านไฟล์รูปไม่ได้";

export async function prepareLogo(
  file: File
): Promise<{ file: File; previewUrl: string } | { error: string }> {
  if (!TYPES.includes(file.type)) return { error: "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP" };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { error: UNREADABLE };
  }

  try {
    // Scratch canvas at reduced size: a full-size canvas fails on iPad for big images.
    const work = logoWorkSize(bitmap.width, bitmap.height);
    const workCanvas = document.createElement("canvas");
    workCanvas.width = work.width;
    workCanvas.height = work.height;
    const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });
    if (!workCtx) return { error: UNREADABLE };
    workCtx.drawImage(bitmap, 0, 0, work.width, work.height);
    const box = logoTrimBox(workCtx.getImageData(0, 0, work.width, work.height).data, work.width, work.height);
    if (!box) return { error: "ไม่พบโลโก้ในรูปนี้" };

    const out = logoOutputSize(box.width, box.height);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = out.width;
    outCanvas.height = out.height;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) return { error: UNREADABLE };
    outCtx.drawImage(workCanvas, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);

    const blob = await new Promise<Blob | null>((resolve) => outCanvas.toBlob(resolve, "image/png"));
    if (!blob) return { error: UNREADABLE };
    if (blob.size > LOGO_MAX_BYTES) return { error: "ไฟล์โลโก้ใหญ่เกินไป" };

    const png = new File([blob], "logo.png", { type: "image/png" });
    return { file: png, previewUrl: URL.createObjectURL(png) };
  } catch {
    return { error: UNREADABLE };
  } finally {
    bitmap.close();
  }
}
