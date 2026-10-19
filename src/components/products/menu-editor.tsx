"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToastManager } from "@/components/ui/toast";
import { saveMenu, uploadProductImage, removeProductImage } from "@/app/actions/products";
import { formatPrice } from "@/lib/cash";
import { resizeImageForUpload } from "@/lib/resize-image";
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_TYPES } from "@/lib/product-images";
import {
  HIGH_PRICE_CONFIRM,
  MAX_PRODUCT_DESCRIPTION,
  MAX_PRODUCT_NAME,
  MAX_RECIPE_QTY,
  type DrinkType,
  type MenuDraft,
} from "@/lib/product-input";
import type { ModifierWithOptions } from "@/types/app";

type MenuEditorProps = {
  productId: string | null;
  initial: MenuDraft;
  imageUrl: string | null;
  categories: { id: string; name: string }[];
  modifiers: ModifierWithOptions[];
  rawMaterials: { id: string; name: string; unit: string; costPerUnit: number }[];
  /** Set when a create landed here because the photo upload failed. */
  photoFailed?: boolean;
};

const PHOTO_FAILED = "บันทึกเมนูแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาลองเพิ่มรูปอีกครั้ง";
const NETWORK = "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";

const DRINK_TYPES: { value: DrinkType | null; label: string }[] = [
  { value: null, label: "ไม่ใช่เครื่องดื่ม" },
  { value: "hot", label: "ร้อน" },
  { value: "iced", label: "เย็น" },
  { value: "blended", label: "ปั่น" },
  { value: "special", label: "Special" },
];

const LABEL = "block text-base font-medium text-sidebar mb-2";
// No width here: recipe rows size their select/qty inputs themselves (w-full would win over w-[92px]).
const FIELD_BASE =
  "h-[50px] rounded-xl border border-input bg-white text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const FIELD = `w-full px-4 ${FIELD_BASE}`;
const CARD = "rounded-2xl bg-white p-5 space-y-4 min-w-0";
const CHIP_GRID = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]";

function chipCls(selected: boolean) {
  return `h-12 px-3 rounded-xl border text-base truncate transition-colors ${
    selected
      ? "bg-accent border-accent text-white font-semibold"
      : "bg-white border-input text-sidebar hover:border-accent"
  }`;
}

export function MenuEditor({
  productId,
  initial,
  imageUrl,
  categories,
  modifiers,
  rawMaterials,
  photoFailed = false,
}: MenuEditorProps) {
  const router = useRouter();
  const toastManager = useToastManager();
  const [draft, setDraft] = useState<MenuDraft>(initial);
  // Once a new menu is saved its id is kept, so saving again updates it instead of creating a duplicate.
  const [savedId, setSavedId] = useState<string | null>(productId);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(photoFailed ? PHOTO_FAILED : null);
  const [confirmedHighPrice, setConfirmedHighPrice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // Free the local preview URL when it's replaced or the editor unmounts.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const shownPhoto = photoPreview ?? (removePhoto ? null : imageUrl);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || photoFile !== null || removePhoto;
  const listHref = `/products?category=${draft.categoryId ?? initial.categoryId ?? "none"}`;
  const priceIsHigh =
    Number(draft.price) >= HIGH_PRICE_CONFIRM && draft.price.trim() !== initial.price.trim();
  const units = new Map(rawMaterials.map((m) => [m.id, m]));
  const cost = draft.recipes.reduce((sum, r) => {
    const m = units.get(r.rawMaterialId);
    const q = Number(r.quantityUsed);
    return m && Number.isFinite(q) ? sum + m.costPerUnit * q : sum;
  }, 0);

  function update(patch: Partial<MenuDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function updateRecipe(index: number, patch: Partial<MenuDraft["recipes"][number]>) {
    setDraft((d) => ({ ...d, recipes: d.recipes.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }

  function toggleModifier(id: string) {
    setDraft((d) => ({
      ...d,
      modifierIds: d.modifierIds.includes(id) ? d.modifierIds.filter((m) => m !== id) : [...d.modifierIds, id],
    }));
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!(file.type in PRODUCT_IMAGE_TYPES)) {
      setPhotoError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
      return;
    }
    setPhotoError(null);
    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    setRemovePhoto(imageUrl !== null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function cancel() {
    if (dirty) setConfirmDiscard(true);
    else router.push(listHref);
  }

  function save() {
    if (priceIsHigh && confirmedHighPrice !== draft.price) {
      setConfirmedHighPrice(draft.price);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveMenu(savedId, draft);
        if ("error" in result) {
          toastManager.add({ title: result.error, type: "error" });
          return;
        }
        setSavedId(result.id);

        if (photoFile) {
          const upload = await resizeImageForUpload(photoFile);
          let uploaded = false;
          if (upload.size <= MAX_PRODUCT_IMAGE_BYTES) {
            const body = new FormData();
            body.append("product_id", result.id);
            body.append("image", upload);
            try {
              uploaded = !("error" in (await uploadProductImage(body)));
            } catch {
              uploaded = false;
            }
          }
          if (!uploaded) {
            if (productId === null) {
              // A full load: after a failed action call, a soft router navigation can be dropped,
              // which would leave the user on "เพิ่มเมนู" with the menu already saved.
              window.location.replace(`/products/${result.id}/edit?photo=failed`);
            } else {
              setPhotoError(PHOTO_FAILED);
              setPhotoFile(null);
              setPhotoPreview(null);
              router.refresh();
            }
            return;
          }
        } else if (removePhoto && savedId !== null) {
          const removed = await removeProductImage(result.id);
          if ("error" in removed) {
            setPhotoError("บันทึกเมนูแล้ว แต่ลบรูปไม่สำเร็จ กรุณาลองใหม่");
            router.refresh();
            return;
          }
        }

        router.push(`/products?category=${result.categoryId ?? "none"}&saved=1`);
      } catch {
        toastManager.add({ title: NETWORK, type: "error" });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 px-4 pt-4 pb-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6 bg-surface flex items-center justify-between gap-4">
        <h1 className="text-[26px] font-bold text-sidebar leading-tight truncate">
          {productId === null ? "เพิ่มเมนู" : "แก้ไขเมนู"}
        </h1>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="h-[52px] px-6 rounded-xl border border-input bg-white text-[17px] font-semibold text-sidebar hover:bg-muted disabled:opacity-60"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-[52px] px-7 rounded-xl bg-accent text-white text-[17px] font-semibold hover:bg-accent/90 disabled:opacity-60"
          >
            {pending ? "กำลังบันทึก…" : "บันทึกเมนู"}
          </button>
        </div>
      </div>

      {photoError && (
        <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-base font-medium text-sidebar">
          {photoError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        {/* Left: the menu itself */}
        <section className={CARD}>
          <h2 className="text-[19px] font-semibold text-sidebar">เมนู</h2>

          <div className="flex items-end gap-4">
            <div className="flex flex-col items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={shownPhoto ? "เปลี่ยนรูปเมนู" : "เพิ่มรูปเมนู"}
                className="w-[104px] h-[104px] rounded-2xl border-2 border-dashed border-input bg-muted/40 overflow-hidden flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:border-accent"
              >
                {shownPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shownPhoto} alt="รูปเมนู" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Camera size={28} />
                    เพิ่มรูป
                  </>
                )}
              </button>
              {shownPhoto && (
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="h-11 px-3 rounded-lg text-[15px] font-medium text-destructive hover:bg-destructive/10"
                >
                  ลบรูป
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />
            </div>
            <div className="flex-1 min-w-0">
              <label htmlFor="menu-name" className={LABEL}>ชื่อเมนู</label>
              <input
                id="menu-name"
                value={draft.name}
                maxLength={MAX_PRODUCT_NAME}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="เช่น มัทฉะลาเต้"
                className={FIELD}
              />
            </div>
          </div>

          <div>
            <label htmlFor="menu-price" className={LABEL}>ราคา (บาท)</label>
            <input
              id="menu-price"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => {
                update({ price: e.target.value });
                setConfirmedHighPrice(null);
              }}
              placeholder="0"
              className={FIELD}
            />
            {confirmedHighPrice !== null && confirmedHighPrice === draft.price && (
              <p role="alert" className="mt-2 text-[15px] font-medium text-warning">
                ราคา ฿{formatPrice(Number(draft.price))} สูงกว่าปกติ — กดบันทึกอีกครั้งเพื่อยืนยัน
              </p>
            )}
          </div>

          <div>
            <span className={LABEL}>หมวดหมู่</span>
            <div className={CHIP_GRID} role="radiogroup" aria-label="หมวดหมู่">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.categoryId === c.id}
                  onClick={() => update({ categoryId: c.id })}
                  className={chipCls(draft.categoryId === c.id)}
                >
                  {c.name}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={draft.categoryId === null}
                onClick={() => update({ categoryId: null })}
                className={chipCls(draft.categoryId === null)}
              >
                ไม่ระบุ
              </button>
            </div>
          </div>

          <div>
            <span className={LABEL}>ประเภทเครื่องดื่ม</span>
            <div className={CHIP_GRID} role="radiogroup" aria-label="ประเภทเครื่องดื่ม">
              {DRINK_TYPES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  role="radio"
                  aria-checked={draft.drinkType === t.value}
                  onClick={() => update({ drinkType: t.value })}
                  className={chipCls(draft.drinkType === t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="menu-description" className={LABEL}>รายละเอียด</label>
            <textarea
              id="menu-description"
              value={draft.description}
              maxLength={MAX_PRODUCT_DESCRIPTION}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="รายละเอียดเมนู (ไม่บังคับ)"
              rows={3}
              className="w-full rounded-xl border border-input bg-white px-4 py-3 text-[17px] leading-relaxed text-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </div>

          <label className="flex items-center gap-3 min-h-12 cursor-pointer">
            <Switch checked={draft.isActive} onCheckedChange={(v) => update({ isActive: v })} />
            <span className="text-[17px] text-sidebar">เปิดขายในหน้า POS</span>
          </label>
        </section>

        {/* Right: options and recipe */}
        <div className="space-y-6 min-w-0">
          <section className={CARD}>
            <h2 className="text-[19px] font-semibold text-sidebar">ตัวเลือกเพิ่มเติม</h2>
            {modifiers.length === 0 ? (
              <p className="text-base text-muted-foreground">
                ยังไม่มีกลุ่มตัวเลือก —{" "}
                <Link href="/modifiers" className="text-accent font-medium hover:underline">
                  ไปสร้างที่หน้า Modifiers
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {modifiers.map((m) => {
                  const on = draft.modifierIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleModifier(m.id)}
                      className={`w-full min-h-[60px] rounded-xl border px-4 py-2 flex items-center gap-3 text-left transition-colors ${
                        on ? "border-2 border-accent bg-accent/5" : "border-input bg-white hover:border-accent"
                      }`}
                    >
                      <span
                        className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center text-white text-sm ${
                          on ? "bg-accent border-accent" : "border-muted-foreground/50"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-medium text-sidebar">
                          {m.name}
                          {m.isRequired && (
                            <span className="ml-2 rounded-md bg-destructive/10 px-2 py-0.5 text-[13px] text-destructive">บังคับ</span>
                          )}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {m.options.map((o) => o.name).join(", ")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className={CARD}>
            <h2 className="text-[19px] font-semibold text-sidebar">สูตรเมนู</h2>
            <p className="text-[15px] text-muted-foreground">วัตถุดิบที่ใช้ต่อ 1 แก้ว ระบบจะหักสต๊อกอัตโนมัติเมื่อขาย</p>
            {rawMaterials.length === 0 ? (
              <p className="text-base text-muted-foreground">
                ยังไม่มีวัตถุดิบ —{" "}
                <Link href="/inventory" className="text-accent font-medium hover:underline">
                  ไปเพิ่มที่หน้า Inventory
                </Link>
              </p>
            ) : (
              <>
                {draft.recipes.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      aria-label="วัตถุดิบ"
                      value={r.rawMaterialId}
                      onChange={(e) => updateRecipe(i, { rawMaterialId: e.target.value })}
                      className={`${FIELD_BASE} flex-1 min-w-0 px-3`}
                    >
                      <option value="">— เลือกวัตถุดิบ —</option>
                      {rawMaterials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="ปริมาณ"
                      inputMode="decimal"
                      value={r.quantityUsed}
                      max={MAX_RECIPE_QTY}
                      onChange={(e) => updateRecipe(i, { quantityUsed: e.target.value })}
                      placeholder="ปริมาณ"
                      className={`${FIELD_BASE} w-[92px] shrink-0 px-3`}
                    />
                    <span className="w-11 shrink-0 text-[15px] text-muted-foreground truncate">
                      {units.get(r.rawMaterialId)?.unit ?? ""}
                    </span>
                    <button
                      type="button"
                      aria-label="ลบวัตถุดิบ"
                      onClick={() => setDraft((d) => ({ ...d, recipes: d.recipes.filter((_, j) => j !== i) }))}
                      className="w-[50px] h-[50px] shrink-0 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, recipes: [...d.recipes, { rawMaterialId: "", quantityUsed: "" }] }))}
                  className="w-full h-12 rounded-xl border border-dashed border-accent text-accent text-base font-semibold flex items-center justify-center gap-2 hover:bg-accent/5"
                >
                  <Plus size={18} />
                  เพิ่มวัตถุดิบ
                </button>
                {cost > 0 && (
                  <p className="rounded-xl bg-muted/50 px-4 py-3 text-base text-sidebar">
                    ต้นทุนวัตถุดิบรวม <span className="font-semibold">฿{formatPrice(Math.round(cost * 100) / 100)}</span>
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="ทิ้งการแก้ไขที่ยังไม่บันทึก?"
          confirmLabel="ทิ้งการแก้ไข"
          cancelLabel="แก้ไขต่อ"
          destructive
          onConfirm={() => router.push(listHref)}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
