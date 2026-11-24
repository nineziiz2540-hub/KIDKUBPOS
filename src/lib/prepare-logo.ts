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
    try {
      // Older iPad WebKit may not know the options argument.
      bitmap = await createImageBitmap(file);
    } catch {
      return { error: UNREADABLE };
    }
  }
  let workCanvas: HTMLCanvasElement | null = null;
  let outCanvas: HTMLCanvasElement | null = null;

  try {
    // Scratch canvas at reduced size: a full-size canvas fails on iPad for big images.
    const work = logoWorkSize(bitmap.width, bitmap.height);
    workCanvas = document.createElement("canvas");
    workCanvas.width = work.width;
    workCanvas.height = work.height;
    const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });
    if (!workCtx) return { error: UNREADABLE };
    workCtx.drawImage(bitmap, 0, 0, work.width, work.height);
    const box = logoTrimBox(workCtx.getImageData(0, 0, work.width, work.height).data, work.width, work.height);
    if (!box) return { error: "ไม่พบโลโก้ในรูปนี้" };

    // Trim box is in work-canvas pixels; map it back to the decoded bitmap so the output keeps full detail.
    const sx = bitmap.width / work.width;
    const sy = bitmap.height / work.height;
    const src = {
      x: Math.round(box.x * sx),
      y: Math.round(box.y * sy),
      width: Math.min(bitmap.width, Math.round(box.width * sx)),
      height: Math.min(bitmap.height, Math.round(box.height * sy)),
    };
    const out = logoOutputSize(src.width, src.height);
    const outCv = document.createElement("canvas");
    outCanvas = outCv;
    outCv.width = out.width;
    outCv.height = out.height;
    const outCtx = outCv.getContext("2d");
    if (!outCtx) return { error: UNREADABLE };
    outCtx.drawImage(bitmap, src.x, src.y, src.width, src.height, 0, 0, out.width, out.height);

    const blob = await new Promise<Blob | null>((resolve) => outCv.toBlob(resolve, "image/png"));
    if (!blob) return { error: UNREADABLE };
    if (blob.size > LOGO_MAX_BYTES) return { error: "ไฟล์โลโก้ใหญ่เกินไป" };

    const png = new File([blob], "logo.png", { type: "image/png" });
    return { file: png, previewUrl: URL.createObjectURL(png) };
  } catch {
    return { error: UNREADABLE };
  } finally {
    if (workCanvas) workCanvas.width = workCanvas.height = 0;
    if (outCanvas) outCanvas.width = outCanvas.height = 0;
    bitmap.close();
  }
}
