"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToastManager } from "@/components/ui/toast";
import { removeProduct } from "@/app/actions/products";

type Props = {
  productId: string;
  productName: string;
  onClose: () => void;
};

export function RemoveProductDialog({ productId, productName, onClose }: Props) {
  const router = useRouter();
  const toastManager = useToastManager();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeProduct(productId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toastManager.add({
        title:
          result.outcome === "deleted"
            ? "ลบเมนูแล้ว"
            : "ย้ายไปเมนูที่เก็บแล้ว (เคยมียอดขาย)",
        type: "success",
      });
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-product-title"
        className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4 text-center"
      >
        <h2 id="remove-product-title" className="text-lg font-bold text-sidebar break-words">
          ลบเมนู &quot;{productName}&quot;?
        </h2>
        <p className="text-base text-muted-foreground">
          ถ้าเมนูนี้เคยขายแล้ว ระบบจะย้ายไปที่ &quot;เมนูที่เก็บแล้ว&quot; แทน
          เพื่อเก็บประวัติบิลและรายงานไว้ กู้คืนได้ภายหลัง
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={confirmRemove}
            disabled={pending}
            className="h-12 bg-destructive text-white text-base hover:bg-destructive/90"
          >
            {pending ? "กำลังลบ…" : "ลบเมนู"}
          </Button>
        </div>
      </div>
    </div>
  );
}
