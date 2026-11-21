"use client";
// "รับของเข้า" from the POS (round D2a, Task 12, R-D2a-26): pick the material -> the amount on the number pad
// in the purchase unit (¼ ½ ¾, or the use unit) -> "บันทึกรับของ". Staff never see a price; a manager or owner
// has the optional "ราคาที่จ่าย (บาท)". The toast and its 5 s "ย้อนกลับ" read as on the inventory page. Every
// server call re-checks the live connection first, so offline nothing is sent.
import { useRef, useState } from "react";
import { useToastManager } from "@/components/ui/toast";
import { NO_ANSWER_WRITE, postReceive, postReceiveUndo } from "@/lib/pos-api";
import { undoErrorMessage } from "@/lib/stock/material-view";
import { RECEIVE_MAX_QTY } from "@/lib/stock/receive-input";
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
    // A fetch to /api/stock/receive, given up after 10 s (never a server action: final review I3). The
    // price (as typed; the server checks it like the inventory form) only goes for an owner or manager,
    // and the server drops a staff price anyway.
    const res = await postReceive({
      materialId: material.id,
      quantity: qty,
      ...(canSeePrice && price.trim() !== "" ? { totalPrice: price.trim() } : {}),
    });
    savingRef.current = false;
    setSaving(false);
    if ("noAnswer" in res) {
      // it may have been saved: say so, never "กำลังบันทึก…" forever; fresh levels show whether it was
      setError(NO_ANSWER_WRITE);
      onChanged();
      return;
    }
    if ("error" in res) {
      setError(res.error);
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
              const undo = await postReceiveUndo(ledgerId);
              if ("noAnswer" in undo) {
                toast.add({ title: NO_ANSWER_WRITE, type: "error" });
                onChanged();
                return;
              }
              if ("error" in undo) {
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
        maxQty={RECEIVE_MAX_QTY}
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
