"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { uploadShopLogo, removeShopLogo } from "@/app/actions/shop-logo";
import { ReceiptBrand } from "@/components/receipt/receipt-brand";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToastManager } from "@/components/ui/toast";
import { LOGO_HINT } from "@/lib/logo-image";
import { prepareLogo } from "@/lib/prepare-logo";
import { RECEIPT_HEADING } from "@/lib/receipt-view";

type Preview = { file: File; url: string };

function MiniHeader({ logoUrl, shopName, sample }: { logoUrl: string | null; shopName: string; sample: boolean }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-4 space-y-2 text-center">
      <ReceiptBrand logoUrl={logoUrl} shopName={shopName} size="full" />
      {sample && (
        <>
          <p className="mt-2 text-center text-xs text-muted-foreground">{RECEIPT_HEADING}</p>
          <p className="mt-3 text-center font-mono tabular-nums">บิล 0001 · คิว 1</p>
        </>
      )}
    </div>
  );
}

export function ShopLogoForm({ logoUrl, shopName }: { logoUrl: string | null; shopName: string }) {
  const toast = useToastManager();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();
  const previewRef = useRef<Preview | null>(null);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  // Revoke the object URL on unmount.
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    };
  }, []);

  function clearPreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setError(null);
    setBusy(true);
    const result = await prepareLogo(picked);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    clearPreview();
    setPreview({ file: result.file, url: result.previewUrl });
  }

  function save() {
    if (!preview) return;
    const fd = new FormData();
    fd.set("logo", preview.file);
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof uploadShopLogo>>;
      try {
        result = await uploadShopLogo(fd);
      } catch {
        setError("อัปโหลดโลโก้ไม่สำเร็จ");
        return;
      }
      if ("error" in result) {
        setError(result.error);
        return;
      }
      clearPreview();
      toast.add({ title: "บันทึกโลโก้แล้ว", type: "success" });
    });
  }

  function remove() {
    setConfirmRemove(false);
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof removeShopLogo>>;
      try {
        result = await removeShopLogo();
      } catch {
        setError("ลบโลโก้ไม่สำเร็จ");
        return;
      }
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.add({ title: "ลบโลโก้แล้ว", type: "success" });
    });
  }

  const buttonBase = "h-12 rounded-xl px-5 text-base font-semibold disabled:opacity-50";

  return (
    <div className="space-y-3">
      {preview ? (
        <MiniHeader logoUrl={preview.url} shopName={shopName} sample />
      ) : (
        <MiniHeader logoUrl={logoUrl} shopName={shopName} sample={false} />
      )}
      <p className="text-sm text-muted-foreground">{LOGO_HINT}</p>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="shop-logo-input"
        onChange={onPick}
      />
      {preview ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={`${buttonBase} bg-accent text-white hover:bg-accent/90`}
          >
            {pending ? "กำลังบันทึก…" : "บันทึกโลโก้"}
          </button>
          <button
            type="button"
            onClick={() => {
              clearPreview();
              setError(null);
            }}
            disabled={pending}
            className={`${buttonBase} border border-input bg-white text-sidebar hover:bg-muted`}
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || pending}
            className={`${buttonBase} border border-input bg-white text-sidebar hover:bg-muted`}
          >
            {busy ? "กำลังเตรียมรูป…" : "เลือกไฟล์โลโก้"}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy || pending}
              className={`${buttonBase} text-destructive hover:bg-destructive/10`}
            >
              ลบโลโก้
            </button>
          )}
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="ลบโลโก้ร้าน?"
          body="ใบเสร็จจะกลับไปแสดงชื่อร้านแทน"
          confirmLabel="ลบโลโก้"
          destructive
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
