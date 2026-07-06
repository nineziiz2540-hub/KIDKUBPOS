"use client";
import { useTransition, useState } from "react";
import { uploadProductImage } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  productId: string;
  currentImageUrl?: string | null;
};

export function ImageUploadSection({ productId, currentImageUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    currentImageUrl ?? null
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("product_id", productId);

    startTransition(async () => {
      const result = await uploadProductImage(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setPreviewUrl(result.url);
        // Reload to reflect the saved URL on the product
        window.location.reload();
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
            อัปโหลดรูปใหม่ (สูงสุด 5MB)
          </Label>
          <Input
            id="img-file"
            name="image"
            type="file"
            accept="image/*"
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
