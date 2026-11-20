"use client";
// "ถุงหิ้ว" (round D2a, Task 8): the shop's bag material and the bags a bill starts with. Owner only.
import { useState, useTransition } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { useToastManager } from "@/components/ui/toast";
import { MAX_BAGS_PER_CUPS, packagingMaterialGroups } from "@/lib/stock/packaging-input";

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  /** the shop's tracked (นับสต๊อก) materials that are in use */
  materials: { id: string; name: string; unit: string; category: string }[];
  defaults: { materialId: string | null; bagsPerCups: number | null };
  /** the saved bag material when it is no longer in the list (archived or not counted) */
  staleMaterialName: string | null;
};

const FIELD = "h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar";

export function BagSettingsForm({ action, materials, defaults, staleMaterialName }: Props) {
  const toast = useToastManager();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const listed = defaults.materialId !== null && materials.some((m) => m.id === defaults.materialId);
  const [materialId, setMaterialId] = useState(listed ? defaults.materialId! : "");
  const [mode, setMode] = useState<"none" | "per_cups">(defaults.bagsPerCups ? "per_cups" : "none");
  const [perCups, setPerCups] = useState(defaults.bagsPerCups ? String(defaults.bagsPerCups) : "2");
  const noMaterial = materialId === "";

  function save() {
    const fd = new FormData();
    fd.set("bag_material_id", materialId);
    fd.set("bag_mode", mode);
    fd.set("bags_per_cups", perCups);
    startTransition(async () => {
      let result: SettingsState;
      try {
        result = await action(undefined, fd);
      } catch {
        result = { error: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" };
      }
      if (result?.error) {
        setError(result.error);
        toast.add({ title: result.error, type: "error" });
        return;
      }
      setError(null);
      toast.add({ title: "บันทึกการตั้งค่าถุงหิ้วแล้ว", type: "success" });
    });
  }

  const radio = (value: "none" | "per_cups") =>
    `flex min-h-14 flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-base text-sidebar ${
      noMaterial ? "opacity-60" : "cursor-pointer"
    } ${mode === value && !noMaterial ? "border-2 border-accent bg-accent/5 font-semibold" : "bg-white"}`;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="bag-material" className="block text-sm font-medium text-sidebar">
          วัตถุดิบถุง
        </label>
        <select id="bag-material" value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={FIELD}>
          <option value="">ไม่นับถุง</option>
          {packagingMaterialGroups(materials).map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {staleMaterialName && (
          <p className="text-sm font-medium text-sidebar">
            <span className="mr-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px] font-semibold">
              ต้องเลือกใหม่
            </span>
            “{staleMaterialName}” ปิดใช้แล้วหรือไม่ได้นับสต๊อก — เลือกวัตถุดิบถุงใหม่แล้วกดบันทึก
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          ตะกร้าบน POS มีตัวนับ “ถุง” เมื่อเลือกวัตถุดิบถุง (เฉพาะวัตถุดิบที่นับสต๊อก)
        </p>
      </div>

      <fieldset className="space-y-2" disabled={noMaterial}>
        <legend className="mb-1.5 text-sm font-medium text-sidebar">ถุงเริ่มต้นต่อบิล</legend>
        <label className={radio("none")}>
          <input
            type="radio"
            name="bag_mode"
            value="none"
            checked={mode === "none"}
            onChange={() => setMode("none")}
            className="size-5 accent-accent"
          />
          ไม่ใส่อัตโนมัติ
          <span className="text-sm font-normal text-muted-foreground">เริ่มที่ 0 ถุง กด + เมื่อให้ถุง</span>
        </label>
        <label className={radio("per_cups")}>
          <input
            type="radio"
            name="bag_mode"
            value="per_cups"
            checked={mode === "per_cups"}
            onChange={() => setMode("per_cups")}
            className="size-5 accent-accent"
          />
          1 ถุงต่อทุก
          <input
            aria-label="จำนวนแก้วต่อ 1 ถุง"
            inputMode="numeric"
            value={perCups}
            disabled={noMaterial || mode !== "per_cups"}
            onChange={(e) => setPerCups(e.target.value)}
            className="h-12 w-20 rounded-lg border bg-white px-3 text-center text-lg text-sidebar disabled:opacity-60"
          />
          แก้ว
          <span className="text-sm font-normal text-muted-foreground">(1–{MAX_BAGS_PER_CUPS} ปัดขึ้น)</span>
        </label>
        {noMaterial && <p className="text-sm text-muted-foreground">เลือกวัตถุดิบถุงก่อน จึงตั้งถุงเริ่มต้นได้</p>}
      </fieldset>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="inline-flex h-14 items-center justify-center rounded-lg bg-accent px-8 text-base font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </div>
  );
}
