"use client";
// "บันทึกของเสีย" (round D2a, Task 11): เมนู | วัตถุดิบ -> pick the thing -> reason chips (tap = saved).
// Menu: the POS tiles, then the option window in waste mode (quantity, แก้วร้าน). Material: the list by
// category (names and units, never a cost), then the number pad with a unit switch. R-D2a-24: no stock
// asks here, a green toast with a 5 s "ย้อนกลับ", and fresh levels (checkNow) after a save or an undo.
import { useRef, useState } from "react";
import { useToastManager } from "@/components/ui/toast";
import { undoWaste, recordWaste } from "@/app/actions/stock-pos";
import type { StockCatalog } from "@/lib/stock/stock-core";
import {
  groupMaterials, OTHER_REASON, WASTE_REASONS, wasteLabel, wasteReasonOf, wasteUndoErrorMessage,
  type WasteInput, type WasteMaterial,
} from "@/lib/stock/waste-input";
import type { CartItem, ModifierWithOptions, PosCategory, PosProduct } from "@/types/app";
import { isPosOnline } from "@/lib/offline/status-store";
import { DisabledReason, OFFLINE_REASON } from "./disabled-reason";
import { MaterialAmountStep, STEP_BACK, STEP_TAB } from "./material-amount-step";
import { OptionWindow } from "./modifier-modal";
import { ProductGrid } from "./product-grid";

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  catalog: StockCatalog;
  materials: WasteMaterial[];
  modifiersFor: (productId: string) => ModifierWithOptions[];
  productsWithOptions: Set<string>;
  /** The live connection: offline the reason chips and the undo do not call the server. */
  online: boolean;
  /** Fresh levels after a save or an undo (the heartbeat's checkNow). */
  onChanged: () => void;
  /** The waste is saved: close the panel. */
  onDone: () => void;
};

type Picked =
  | { kind: "menu"; product: PosProduct; line: CartItem }
  | { kind: "material"; material: WasteMaterial; qty: number };

const TAB = STEP_TAB;
const BACK = STEP_BACK;

export function WasteFlow({ online, products, categories, catalog, materials, modifiersFor, productsWithOptions, onChanged, onDone }: Props) {
  const toast = useToastManager();
  const [tab, setTab] = useState<"menu" | "material">("menu");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [optionProduct, setOptionProduct] = useState<PosProduct | null>(null);
  const [material, setMaterial] = useState<WasteMaterial | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function save(reason: string, otherText?: string) {
    if (!picked || savingRef.current) return;
    if (!isPosOnline()) {
      setError(OFFLINE_REASON);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const input: WasteInput =
      picked.kind === "menu"
        ? {
            kind: "menu",
            productId: picked.product.id,
            quantity: picked.line.quantity,
            ...(picked.line.choices ? { choices: picked.line.choices } : {}),
            optionIds: picked.line.selectedModifiers.map((m) => m.optionId),
            ...(picked.line.houseGlass !== undefined ? { houseGlass: picked.line.houseGlass } : {}),
            reason,
            ...(otherText !== undefined ? { otherText } : {}),
          }
        : { kind: "material", materialId: picked.material.id, qty: picked.qty, reason, ...(otherText !== undefined ? { otherText } : {}) };
    let res: Awaited<ReturnType<typeof recordWaste>>;
    try {
      res = await recordWaste(input);
    } catch {
      res = { error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
    savingRef.current = false;
    setSaving(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onChanged();
    const { refId, label } = res;
    let done = false;
    const toastId = toast.add({
      title: `บันทึกของเสีย: ${label} (${wasteReasonOf(input)})`,
      type: "success",
      timeout: 5000,
      actionProps: {
        children: "ย้อนกลับ",
        onClick: async () => {
          if (done) return;
          // The toast outlives this screen: ask the connection now, not what it was when it was drawn.
          if (!isPosOnline()) {
            toast.add({ title: OFFLINE_REASON, type: "error" });
            return;
          }
          done = true;
          toast.close(toastId);
          let undo: { error?: string };
          try {
            undo = await undoWaste(refId);
          } catch {
            undo = { error: wasteUndoErrorMessage(undefined) };
          }
          if (undo.error) {
            toast.add({ title: undo.error, type: "error" });
            return;
          }
          onChanged();
          toast.add({ title: `ย้อนกลับแล้ว: ${label}`, type: "success" });
        },
      },
    });
    onDone();
  }

  if (picked) {
    const label =
      picked.kind === "menu"
        ? wasteLabel(
            { kind: "menu", productId: picked.product.id, quantity: picked.line.quantity, optionIds: [], reason: "" },
            { name: picked.product.name, parts: (picked.line.choices?.slots ?? []).map((s) => s.label) }
          )
        : wasteLabel(
            { kind: "material", materialId: picked.material.id, qty: picked.qty, reason: "" },
            { name: picked.material.name, unit: picked.material.unit }
          );
    return (
      <ReasonStep online={online} label={label} saving={saving} error={error} onBack={() => { setPicked(null); setError(null); }} onPick={save} />
    );
  }

  if (material) {
    return (
      <MaterialAmountStep
        material={material}
        primaryLabel="ต่อไป"
        onBack={() => setMaterial(null)}
        onSubmit={({ qty }) => setPicked({ kind: "material", material, qty })}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" className="flex shrink-0 gap-2">
        {(
          [
            ["menu", "เมนู"],
            ["material", "วัตถุดิบ"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`${TAB} ${tab === id ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "menu" ? (
        <div className="min-h-0 flex-1">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithOptions}
            onProductClick={(product) => setOptionProduct(product)}
          />
        </div>
      ) : (
        <MaterialList materials={materials} onPick={setMaterial} />
      )}
      {optionProduct && (
        <OptionWindow
          key={optionProduct.id}
          mode="waste"
          product={optionProduct}
          modifiers={modifiersFor(optionProduct.id)}
          catalog={catalog}
          onSave={(line) => {
            setPicked({ kind: "menu", product: optionProduct, line });
            setOptionProduct(null);
          }}
          onClose={() => setOptionProduct(null)}
        />
      )}
    </div>
  );
}

export function MaterialList({ materials, onPick }: { materials: WasteMaterial[]; onPick: (m: WasteMaterial) => void }) {
  const groups = groupMaterials(materials);
  if (groups.length === 0) {
    return <p className="rounded-lg bg-muted px-3 py-4 text-center text-base text-muted-foreground">ยังไม่มีวัตถุดิบที่นับสต๊อก</p>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      {groups.map((g) => (
        <section key={g.category}>
          <h3 className="mb-1.5 text-base font-semibold text-muted-foreground">{g.category}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-lg border-2 border-input bg-white px-4 text-left text-lg font-semibold text-sidebar hover:border-accent active:scale-[0.98]"
              >
                <span className="min-w-0 break-words">{m.name}</span>
                <span className="shrink-0 text-base font-normal text-muted-foreground">{m.unit}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ReasonStep({
  online, label, saving, error, onBack, onPick,
}: {
  online: boolean;
  label: string;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onPick: (reason: string, otherText?: string) => void;
}) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const off = saving || !online;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={saving} className={BACK}>กลับ</button>
        <p className="min-w-0 text-xl font-bold text-sidebar">{label}</p>
      </div>
      <p className="text-base font-semibold text-sidebar">เพราะอะไร?</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WASTE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            disabled={off}
            aria-pressed={r === OTHER_REASON ? other : undefined}
            onClick={() => (r === OTHER_REASON ? setOther(true) : onPick(r))}
            className={`min-h-14 rounded-lg border-2 px-2 text-lg font-semibold transition-colors disabled:opacity-50 ${
              r === OTHER_REASON && other ? "border-accent bg-accent/10 text-sidebar" : "border-input bg-white text-sidebar hover:border-accent"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      {other && (
        <div className="flex gap-2">
          <input
            value={text}
            maxLength={100}
            onChange={(e) => setText(e.target.value)}
            placeholder="พิมพ์เหตุผลสั้น ๆ"
            aria-label="พิมพ์เหตุผลสั้น ๆ"
            className="h-14 min-w-0 flex-1 rounded-lg border-2 border-input bg-white px-3 text-lg text-sidebar"
          />
          <button
            type="button"
            disabled={off || trimmed === ""}
            onClick={() => onPick(OTHER_REASON, trimmed)}
            className="h-14 shrink-0 rounded-lg bg-accent px-6 text-lg font-bold text-white disabled:bg-accent/40 disabled:cursor-not-allowed"
          >
            บันทึก
          </button>
        </div>
      )}
      {!online && <DisabledReason what={["บันทึก"]} reason={OFFLINE_REASON} />}
      {saving && <p role="status" className="text-base text-muted-foreground">กำลังบันทึก…</p>}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-base font-semibold text-destructive">{error}</p>}
    </div>
  );
}
