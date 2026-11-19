"use client";
import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ModifierState } from "@/app/actions/modifiers";
import { createModifierOption, saveOptionEffects } from "@/app/actions/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToastManager } from "@/components/ui/toast";
import { parseEffectDrafts, type EffectDraft } from "@/lib/stock/option-effects";

type Props = { modifierId: string };

export function ModifierOptionForm({ modifierId }: Props) {
  const [state, formAction, pending] = useActionState<ModifierState, FormData>(
    createModifierOption,
    undefined
  );

  return (
    <form action={formAction} className="flex items-end gap-2 flex-wrap">
      <input type="hidden" name="modifier_id" value={modifierId} />

      <div className="space-y-1 min-w-[120px]">
        <Label htmlFor={`opt-name-${modifierId}`} className="text-xs">ชื่อตัวเลือก</Label>
        <Input
          id={`opt-name-${modifierId}`}
          name="name"
          placeholder="เช่น 50%, ไข่มุก"
          className="h-8 text-sm"
          required
        />
      </div>
      <div className="space-y-1 w-[100px]">
        <Label htmlFor={`opt-price-${modifierId}`} className="text-xs">ราคา +/- (บาท)</Label>
        <Input
          id={`opt-price-${modifierId}`}
          name="price_delta"
          type="number"
          step="0.01"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1 w-[70px]">
        <Label htmlFor={`opt-order-${modifierId}`} className="text-xs">ลำดับ</Label>
        <Input
          id={`opt-order-${modifierId}`}
          name="sort_order"
          type="number"
          min="0"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        size="sm"
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "…" : "+ เพิ่ม"}
      </Button>

      {state?.error && (
        <p className="text-sm font-medium text-destructive w-full">{state.error}</p>
      )}
    </form>
  );
}

// ── "ผลต่อสต๊อก" of one option (round D1) ───────────────────────────────────────────────────────────

/** A bean / matcha group an option can add to (never the sweetener group). */
export type EffectGroup = { id: string; name: string; unit: string };
/** A material an option can add; archived ones appear only when an effect still points at them. */
export type EffectMaterial = { id: string; name: string; unit: string; archived: boolean };

const KIND_WORD: Record<EffectDraft["kind"], string> = {
  slot_add: "เพิ่มในช่องเมล็ด/มัทฉะ",
  material_add: "เพิ่มวัตถุดิบ",
};
const FIELD =
  "h-14 rounded-xl border border-input bg-white text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const ARCHIVED_BADGE = "mr-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px] font-semibold";

function kindChip(on: boolean) {
  return `h-14 rounded-xl border px-3 text-base font-semibold transition-colors disabled:opacity-50 ${
    on ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"
  }`;
}

export function OptionStockEffects({
  optionId,
  optionName,
  initial,
  groups,
  materials,
}: {
  optionId: string;
  optionName: string;
  initial: EffectDraft[];
  groups: EffectGroup[];
  materials: EffectMaterial[];
}) {
  const toast = useToastManager();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EffectDraft[]>(initial);
  const [pending, startTransition] = useTransition();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const blankRow = (): EffectDraft => ({ kind: groups.length > 0 ? "slot_add" : "material_add", targetId: "", amount: "" });

  function describe(e: EffectDraft): string {
    if (e.kind === "slot_add") {
      const g = groupById.get(e.targetId);
      return `${KIND_WORD.slot_add} ${g?.name ?? "(กลุ่มที่ไม่พบ)"} +${e.amount}${g?.unit ? ` ${g.unit}` : ""}`;
    }
    const m = materialById.get(e.targetId);
    const name = m ? `${m.name}${m.archived ? " (ปิดใช้แล้ว)" : ""}` : "(วัตถุดิบที่ไม่พบ)";
    return `เพิ่ม ${name} +${e.amount}${m?.unit ? ` ${m.unit}` : ""}`;
  }

  function update(i: number, row: EffectDraft) {
    setRows((rs) => rs.map((r, j) => (j === i ? row : r)));
  }

  function save() {
    const parsed = parseEffectDrafts(rows);
    if ("error" in parsed) {
      toast.add({ title: parsed.error, type: "error" });
      return;
    }
    startTransition(async () => {
      let result: ModifierState;
      try {
        result = await saveOptionEffects(optionId, parsed.value);
      } catch {
        result = { error: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" };
      }
      if (result?.error) {
        toast.add({ title: result.error, type: "error" });
        return;
      }
      toast.add({ title: `บันทึกผลต่อสต๊อกของ “${optionName}” แล้ว`, type: "success" });
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[15px] text-sidebar">
          <span className="font-medium">ผลต่อสต๊อก:</span>{" "}
          {initial.length === 0 ? <span className="text-muted-foreground">ไม่มี</span> : initial.map(describe).join(" · ")}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRows(initial.length > 0 ? initial : [blankRow()]);
            setOpen(true);
          }}
          className="h-14 px-5 text-base font-semibold"
        >
          ตั้งผลต่อสต๊อก
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-input bg-muted/20 p-3">
      <p className="text-base font-semibold text-sidebar">ผลต่อสต๊อก — {optionName}</p>
      {rows.map((row, i) => {
        const unit = row.kind === "slot_add" ? groupById.get(row.targetId)?.unit : materialById.get(row.targetId)?.unit;
        const current = row.kind === "material_add" ? materialById.get(row.targetId) : undefined;
        return (
          <div key={i} className="space-y-2 rounded-xl border border-input bg-white p-3">
            <div role="radiogroup" aria-label="ชนิดผลต่อสต๊อก" className="grid grid-cols-2 gap-2">
              {(["slot_add", "material_add"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={row.kind === kind}
                  disabled={kind === "slot_add" && groups.length === 0 && row.kind !== "slot_add"}
                  onClick={() => row.kind !== kind && update(i, { kind, targetId: "", amount: row.amount })}
                  className={kindChip(row.kind === kind)}
                >
                  {row.kind === kind ? "✓ " : ""}
                  {KIND_WORD[kind]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label={row.kind === "slot_add" ? "เมล็ด/มัทฉะ" : "วัตถุดิบ"}
                value={row.targetId}
                onChange={(e) => update(i, { ...row, targetId: e.target.value })}
                className={`${FIELD} min-w-0 flex-1 px-3`}
              >
                <option value="">{row.kind === "slot_add" ? "— เลือกเมล็ด/มัทฉะ —" : "— เลือกวัตถุดิบ —"}</option>
                {row.kind === "slot_add" && row.targetId !== "" && !groupById.has(row.targetId) && (
                  <option value={row.targetId} disabled>
                    (กลุ่มที่ไม่พบ)
                  </option>
                )}
                {row.kind === "material_add" && row.targetId !== "" && (!current || current.archived) && (
                  <option value={row.targetId} disabled>
                    {current ? `${current.name} (ปิดใช้แล้ว)` : "(วัตถุดิบที่ไม่พบ)"}
                  </option>
                )}
                {row.kind === "slot_add"
                  ? groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))
                  : materials
                      .filter((m) => !m.archived)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
              </select>
              <input
                aria-label="ปริมาณ"
                inputMode="decimal"
                value={row.amount}
                placeholder="ปริมาณ"
                onChange={(e) => update(i, { ...row, amount: e.target.value })}
                className={`${FIELD} w-[100px] shrink-0 px-3`}
              />
              <span className="w-11 shrink-0 truncate text-[15px] text-muted-foreground">{unit ?? ""}</span>
              <button
                type="button"
                aria-label="ลบบรรทัด"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                <Trash2 size={20} />
              </button>
            </div>
            {current?.archived && (
              <p className="text-[15px] text-sidebar">
                <span className={ARCHIVED_BADGE}>ปิดใช้แล้ว</span>
                เลือกวัตถุดิบอื่นแทน หรือลบบรรทัดนี้ก่อนบันทึก
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, blankRow()])}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-accent text-base font-semibold text-accent hover:bg-accent/5"
      >
        <Plus size={18} />
        เพิ่มผลต่อสต๊อก
      </button>
      <p className="text-[15px] text-muted-foreground">
        “เพิ่มในช่องเมล็ด/มัทฉะ” หักจากเมล็ด/มัทฉะร้านตัวเดียวกับแก้วนั้น เช่น เพิ่มช็อต +9 g — ถ้าแก้วใช้ตัวพิเศษ
        จะหักจากตัวของร้านที่เลือกในหน้าขาย (ไม่บวกราคาพิเศษ)
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกผลต่อสต๊อก"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="h-14 px-6 text-base font-semibold"
        >
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
