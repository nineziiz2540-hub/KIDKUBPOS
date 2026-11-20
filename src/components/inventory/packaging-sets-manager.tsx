"use client";
// "ชุดภาชนะ" list + form (round D2a, Task 8). Owner/manager page: costs per cup are shown.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToastManager } from "@/components/ui/toast";
import { archivePackagingSet, savePackagingSet } from "@/app/actions/packaging";
import { formatPrice } from "@/lib/cash";
import {
  MAX_PACKAGING_ITEMS,
  MAX_PACKAGING_NAME,
  packagingMaterialGroups,
  packagingSetCost,
  parsePackagingSetDraft,
  setInUseMessage,
  type PackagingItemDraft,
} from "@/lib/stock/packaging-input";

export type PackagingSetProps = {
  id: string;
  name: string;
  items: { materialId: string; qty: number }[];
  /** menus (not archived) that use the set */
  menus: string[];
};
export type PackagingMaterial = {
  id: string;
  name: string;
  unit: string;
  category: string;
  costPerUnit: number;
  archived: boolean;
};

type Editing = { id: string | null; name: string; items: PackagingItemDraft[] };

const BTN = "inline-flex h-14 items-center justify-center rounded-lg px-5 text-base font-semibold disabled:opacity-60";
const BTN_PRIMARY = `${BTN} bg-accent text-white hover:bg-accent/90`;
const BTN_OUTLINE = `${BTN} border bg-white text-sidebar hover:bg-muted`;
const FIELD = "h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar";
const NETWORK = "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";

function money(satang: number) {
  return `฿${formatPrice(satang / 100)}`;
}

function CostLine({ items, materials }: { items: { materialId: string; qty: number }[]; materials: PackagingMaterial[] }) {
  const cost = packagingSetCost(items, materials);
  return (
    <p className="text-base font-medium text-sidebar">
      ต้นทุนต่อแก้ว {money(cost.costSatang)}
      {cost.missingMaterials.length > 0 && (
        <span className="ml-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px] font-semibold">
          ยังไม่มีราคาทุน: {cost.missingMaterials.join(", ")}
        </span>
      )}
    </p>
  );
}

function SetForm({
  editing,
  materials,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing;
  materials: PackagingMaterial[];
  busy: boolean;
  onChange: (e: Editing) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  // Only materials in use are offered; an archived one stays visible on the row that still has it.
  const groups = packagingMaterialGroups(materials.filter((m) => !m.archived));
  const taken = new Set(editing.items.map((i) => i.materialId).filter((id) => id !== ""));
  // Live cost of the rows that are complete enough to price.
  const priced = editing.items.flatMap((i) => {
    const qty = Number(i.qty.trim());
    return i.materialId !== "" && i.qty.trim() !== "" && Number.isFinite(qty) && qty > 0 ? [{ materialId: i.materialId, qty }] : [];
  });

  function setItem(index: number, patch: Partial<PackagingItemDraft>) {
    onChange({ ...editing, items: editing.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  }

  return (
    <div className="space-y-4 rounded-lg border-2 border-accent bg-white p-5">
      <h2 className="text-lg font-semibold text-sidebar">{editing.id === null ? "สร้างชุดภาชนะ" : "แก้ไขชุดภาชนะ"}</h2>
      <div>
        <label htmlFor="packaging-name" className="block text-sm text-muted-foreground">
          ชื่อชุดภาชนะ
        </label>
        <input
          id="packaging-name"
          value={editing.name}
          maxLength={MAX_PACKAGING_NAME}
          placeholder="เช่น แก้วเย็น 16oz"
          onChange={(e) => onChange({ ...editing, name: e.target.value })}
          className={`mt-1 ${FIELD}`}
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">วัตถุดิบที่หักต่อ 1 แก้ว</p>
        {editing.items.map((item, index) => {
          const current = byId.get(item.materialId);
          return (
            <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
              <div className="min-w-0 flex-1 basis-60">
                <label htmlFor={`packaging-item-${index}`} className="block text-sm text-muted-foreground">
                  วัตถุดิบ
                </label>
                <select
                  id={`packaging-item-${index}`}
                  value={item.materialId}
                  onChange={(e) => setItem(index, { materialId: e.target.value })}
                  className={`mt-1 ${FIELD}`}
                >
                  <option value="">เลือกวัตถุดิบ…</option>
                  {current?.archived && (
                    <option value={current.id}>
                      {current.name} (ปิดใช้แล้ว)
                    </option>
                  )}
                  {groups.map((g) => (
                    <optgroup key={g.category} label={g.category}>
                      {g.items.map((m) => (
                        <option key={m.id} value={m.id} disabled={taken.has(m.id) && m.id !== item.materialId}>
                          {m.name} ({m.unit})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {current?.archived && (
                  <p className="mt-1 text-sm font-semibold text-sidebar">
                    <span className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px]">ปิดใช้แล้ว</span>{" "}
                    ไม่ถูกหักแล้ว — ลบบรรทัดนี้หรือเลือกวัตถุดิบอื่น
                  </p>
                )}
              </div>
              <div className="w-36">
                <label htmlFor={`packaging-qty-${index}`} className="block text-sm text-muted-foreground">
                  จำนวนต่อแก้ว{current ? ` (${current.unit})` : ""}
                </label>
                <input
                  id={`packaging-qty-${index}`}
                  inputMode="decimal"
                  value={item.qty}
                  placeholder="1"
                  onChange={(e) => setItem(index, { qty: e.target.value })}
                  className={`mt-1 ${FIELD}`}
                />
              </div>
              <button
                type="button"
                aria-label="ลบบรรทัดนี้"
                onClick={() => onChange({ ...editing, items: editing.items.filter((_, i) => i !== index) })}
                className="inline-flex h-14 items-center gap-1 rounded-lg border bg-white px-4 text-base font-medium text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={20} />
                ลบ
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={editing.items.length >= MAX_PACKAGING_ITEMS}
          onClick={() => onChange({ ...editing, items: [...editing.items, { materialId: "", qty: "1" }] })}
          className={BTN_OUTLINE}
        >
          + เพิ่มวัตถุดิบ
        </button>
      </div>

      <CostLine items={priced} materials={materials} />

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onSave} className={`${BTN_PRIMARY} min-w-40`}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN_OUTLINE}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export function PackagingSetsManager({ sets, materials }: { sets: PackagingSetProps[]; materials: PackagingMaterial[] }) {
  const toast = useToastManager();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<PackagingSetProps | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map(materials.map((m) => [m.id, m]));

  async function save() {
    if (!editing || busy) return;
    // Same checks as the server, for an instant answer; the server checks again.
    const parsed = parsePackagingSetDraft({ name: editing.name, items: editing.items });
    if ("error" in parsed) {
      toast.add({ title: parsed.error, type: "error" });
      return;
    }
    setBusy(true);
    try {
      const result = await savePackagingSet(editing.id, { name: editing.name, items: editing.items });
      if ("error" in result) {
        toast.add({ title: result.error, type: "error" });
        return;
      }
      toast.add({ title: `บันทึกชุดภาชนะแล้ว: ${result.name}`, type: "success" });
      setEditing(null);
    } catch {
      toast.add({ title: NETWORK, type: "error" });
    } finally {
      setBusy(false);
    }
  }

  function askArchive(set: PackagingSetProps) {
    // Known to be in use: the server would refuse, so say why straight away.
    if (set.menus.length > 0) {
      toast.add({ title: setInUseMessage(set.menus), type: "error" });
      return;
    }
    setArchiving(set);
  }

  async function archive() {
    const set = archiving;
    setArchiving(null);
    if (!set || busy) return;
    setBusy(true);
    try {
      const result = await archivePackagingSet(set.id);
      if ("error" in result) toast.add({ title: result.error, type: "error" });
      else toast.add({ title: `เก็บเข้าคลังแล้ว: ${set.name}`, type: "success" });
    } catch {
      toast.add({ title: NETWORK, type: "error" });
    } finally {
      setBusy(false);
    }
  }

  const edit = (s: PackagingSetProps) =>
    setEditing({ id: s.id, name: s.name, items: s.items.map((i) => ({ materialId: i.materialId, qty: String(i.qty) })) });

  const form = editing && (
    <SetForm
      editing={editing}
      materials={materials}
      busy={busy}
      onChange={setEditing}
      onSave={save}
      onCancel={() => setEditing(null)}
    />
  );

  return (
    <div className="space-y-4">
      {editing?.id === null ? (
        form
      ) : (
        <button
          type="button"
          disabled={editing !== null}
          onClick={() => setEditing({ id: null, name: "", items: [{ materialId: "", qty: "1" }] })}
          className={BTN_PRIMARY}
        >
          + สร้างชุดภาชนะ
        </button>
      )}

      {sets.length === 0 && editing?.id !== null && (
        <p className="rounded-lg border bg-white p-6 text-center text-base text-muted-foreground">
          ยังไม่มีชุดภาชนะ — กด “สร้างชุดภาชนะ” เช่น แก้วเย็น 16oz = แก้ว 16oz + ฝาโดม + หลอด
        </p>
      )}

      <ul className="space-y-3">
        {sets.map((s) =>
          editing?.id === s.id ? (
            <li key={s.id}>{form}</li>
          ) : (
            <li key={s.id} className="space-y-2 rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-sidebar">{s.name}</h2>
                <CostLine items={s.items} materials={materials} />
              </div>
              <p className="text-base text-sidebar">
                {s.items.map((i, index) => {
                  const m = byId.get(i.materialId);
                  return (
                    <span key={i.materialId}>
                      {index > 0 && " · "}
                      {m?.name ?? "(วัตถุดิบถูกลบ)"} × {i.qty} {m?.unit ?? ""}
                      {m?.archived && (
                        <span className="ml-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px] font-semibold">
                          ปิดใช้แล้ว
                        </span>
                      )}
                    </span>
                  );
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {s.menus.length > 0 ? `ใช้ในเมนู: ${s.menus.join(", ")}` : "ยังไม่มีเมนูใช้ชุดนี้"}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={editing !== null || busy} onClick={() => edit(s)} className={BTN_OUTLINE}>
                  แก้ไข
                </button>
                <button
                  type="button"
                  disabled={editing !== null || busy}
                  onClick={() => askArchive(s)}
                  className={BTN_OUTLINE}
                >
                  เก็บเข้าคลัง
                </button>
              </div>
            </li>
          )
        )}
      </ul>

      {archiving && (
        <ConfirmDialog
          title={`เก็บ “${archiving.name}” เข้าคลัง?`}
          body="ชุดนี้จะไม่ให้เลือกในเมนูอีก และนำกลับมาไม่ได้ (สร้างใหม่ด้วยชื่อเดิมได้)"
          confirmLabel="เก็บเข้าคลัง"
          destructive
          onConfirm={archive}
          onCancel={() => setArchiving(null)}
        />
      )}
    </div>
  );
}
