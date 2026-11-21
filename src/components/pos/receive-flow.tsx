"use client";
// "รับของเข้า" from the POS (round D2a, Task 12, R-D2a-26): pick the material -> the amount on the number pad
// in the purchase unit (¼ ½ ¾, or the use unit) -> "บันทึกรับของ". Staff never see a price; a manager or owner
// has the optional "ราคาที่จ่าย (บาท)". The toast and its 5 s "ย้อนกลับ" read as on the inventory page. Every
// server call re-checks the live connection first, so offline nothing is sent.
import { useRef, useState } from "react";
import { useToastManager } from "@/components/ui/toast";
import { receiveStock, undoReceive } from "@/app/actions/inventory";
import { undoErrorMessage } from "@/lib/stock/material-view";
import type { WasteMaterial } from "@/lib/stock/waste-input";
import { isPosOnline } from "@/lib/offline/status-store";
import { OFFLINE_REASON } from "./disabled-reason";
import { MaterialAmountStep, type AmountEntry } from "./material-amount-step";
import { MaterialList } from "./waste-flow";

type Props = {
  materials: WasteMaterial[];
  /** Owner or manager: the optional price field shows. Staff: no price field at all. */
  canSeePrice: boolean;
  /** The live connection: offline the save does not call the server. */
  online: boolean;
  /** Fresh levels after a save or an undo (the heartbeat's checkNow). */
  onChanged: () => void;
  /** The receive is saved: close the panel. */
  onDone: () => void;
};

export function ReceiveFlow({ materials, canSeePrice, online, onChanged, onDone }: Props) {
  const toast = useToastManager();
  const [material, setMaterial] = useState<WasteMaterial | null>(null);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function save({ qty, entry, entryUnit }: AmountEntry) {
    if (!material || savingRef.current) return;
    if (!isPosOnline()) {
      setError(OFFLINE_REASON);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set("raw_material_id", material.id);
    fd.set("quantity", String(qty));
    if (canSeePrice && price.trim() !== "") fd.set("total_price", price.trim());
    let res: Awaited<ReturnType<typeof receiveStock>>;
    try {
      res = await receiveStock(undefined, fd);
    } catch {
      res = { error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
    savingRef.current = false;
    setSaving(false);
    if (!res?.success) {
      setError(res?.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    onChanged();
    const { ledgerId } = res;
    const name = material.name;
    let done = false;
    const toastId = toast.add({
      title: `รับของเข้า: ${name} ${entry} ${entryUnit}`,
      type: "success",
      timeout: 5000,
      actionProps: ledgerId
        ? {
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
              let undo: Awaited<ReturnType<typeof undoReceive>>;
              try {
                undo = await undoReceive(ledgerId);
              } catch {
                undo = { error: "ย้อนกลับไม่สำเร็จ" };
              }
              if (undo?.error) {
                toast.add({ title: undoErrorMessage(undo.error), type: "error" });
                return;
              }
              onChanged();
              toast.add({ title: `ย้อนกลับแล้ว: ${name}`, type: "success" });
            },
          }
        : undefined,
    });
    onDone();
  }

  if (material) {
    return (
      <MaterialAmountStep
        key={material.id}
        material={material}
        primaryLabel="บันทึกรับของ"
        online={online}
        busy={saving}
        error={error}
        onBack={() => { setMaterial(null); setError(null); setPrice(""); }}
        onSubmit={save}
        extra={
          canSeePrice ? (
            <label className="block space-y-1.5">
              <span className="text-base font-semibold text-sidebar">ราคาที่จ่าย (บาท)</span>
              <input
                name="total_price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="ไม่บังคับ"
                className="h-14 w-full rounded-lg border-2 border-input bg-white px-3 text-lg text-sidebar"
              />
            </label>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="shrink-0 text-base font-semibold text-sidebar">รับอะไรเข้ามา?</p>
      <MaterialList materials={materials} onPick={setMaterial} />
    </div>
  );
}
