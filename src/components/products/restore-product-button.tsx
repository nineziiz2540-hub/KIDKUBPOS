"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToastManager } from "@/components/ui/toast";
import { restoreProduct } from "@/app/actions/products";

export function RestoreProductButton({ productId }: { productId: string }) {
  const router = useRouter();
  const toastManager = useToastManager();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      className="h-10 px-4"
      onClick={() =>
        startTransition(async () => {
          const result = await restoreProduct(productId);
          if ("error" in result) {
            toastManager.add({ title: result.error, type: "error" });
            return;
          }
          toastManager.add({
            title: "กู้คืนแล้ว — เมนูยังปิดอยู่ เปิดได้ที่หน้าแก้ไข",
            type: "success",
          });
          router.refresh();
        })
      }
    >
      {pending ? "กำลังกู้คืน…" : "กู้คืน"}
    </Button>
  );
}
