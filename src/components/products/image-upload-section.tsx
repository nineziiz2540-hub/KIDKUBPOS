"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_TYPES } from "@/lib/product-images";
import { resizeImageForUpload } from "@/lib/resize-image";
import { uploadProductImage } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  productId: string;
  currentImageUrl?: string | null;
};

export function ImageUploadSection({ productId, currentImageUrl }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    currentImageUrl ?? null
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const file = formData.get("image");
    if (!(file instanceof File) || file.size === 0) {
      setError("ไม่พบไฟล์");
      return;
    }
    if (!(file.type in PRODUCT_IMAGE_TYPES)) {
      setError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
      return;
    }

    startTransition(async () => {
      // Camera photos are shrunk on the device first; the 5MB limit applies to what is sent.
      const upload = await resizeImageForUpload(file);
      if (upload.size > MAX_PRODUCT_IMAGE_BYTES) {
        setError("ไฟล์ขนาดใหญ่เกิน 5MB");
        return;
      }
      const body = new FormData();
      body.append("product_id", productId);
      body.append("image", upload);
      try {
        const result = await uploadProductImage(body);
        if ("error" in result) {
          setError(result.error);
        } else {
          setPreviewUrl(result.url);
          router.refresh();
        }
      } catch {
        setError("อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Label>รูปภาพสินค้า</Label>
      {previewUrl && (
        <div className="w-32 h-32 rounded-lg border overflow-hidden">
          {/* Using plain <img> to avoid next/image domain config requirement */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="รูปสินค้า"
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="img-file" className="text-xs text-muted-foreground">
            อัปโหลดรูปใหม่ (JPG, PNG, WebP สูงสุด 5MB)
          </Label>
          <Input
            id="img-file"
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="w-auto text-sm"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={isPending}
          variant="outline"
          size="sm"
        >
          {isPending ? "กำลังอัปโหลด…" : "อัปโหลด"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
