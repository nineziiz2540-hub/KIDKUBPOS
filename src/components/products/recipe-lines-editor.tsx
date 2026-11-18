"use client";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MAX_RECIPE_QTY } from "@/lib/product-input";
import type { FixedLineDraft, RecipeLineDraft, SlotLineDraft } from "@/lib/menu-draft";
import type { EditorGroup, EditorMaterial } from "./menu-editor-types";

const FIELD =
  "h-14 rounded-xl border border-input bg-white text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const ARCHIVED_BADGE = "shrink-0 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[13px] font-semibold text-sidebar";

function kindChip(selected: boolean) {
  return `h-14 rounded-xl border px-3 text-base font-semibold transition-colors disabled:opacity-50 ${
    selected ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"
  }`;
}

/** "เมล็ดพิเศษ" / "มัทฉะพิเศษ" in the group's own words. */
function specialWord(kind: EditorGroup["kind"]) {
  return kind === "matcha" ? "มัทฉะพิเศษ" : "เมล็ดพิเศษ";
}

/** The label the group itself defaults to (what "ค่าเริ่มต้นของกลุ่ม" means for this group). */
function groupDefaultLabel(group: EditorGroup | undefined): string | null {
  if (!group) return null;
  const usable = group.members.filter((m) => !m.archived);
  return (usable.find((m) => m.isDefault) ?? usable.find((m) => m.tier === "house"))?.label ?? null;
}

function groupUnit(group: EditorGroup | undefined): string {
  return group?.members.find((m) => !m.archived)?.unit ?? "";
}

export function RecipeLinesEditor({
  lines,
  onChange,
  materials,
  groups,
}: {
  lines: RecipeLineDraft[];
  onChange: (lines: RecipeLineDraft[]) => void;
  /** active materials and the archived ones this menu still uses */
  materials: EditorMaterial[];
  /** groups a recipe line can draw from (bean / matcha / other — never the sweetener group) */
  groups: EditorGroup[];
}) {
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const active = materials.filter((m) => !m.archived);

  function update(index: number, line: RecipeLineDraft) {
    onChange(lines.map((l, i) => (i === index ? line : l)));
  }
  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function setKind(index: number, kind: RecipeLineDraft["kind"]) {
    const line = lines[index]!;
    if (line.kind === kind) return;
    update(
      index,
      kind === "fixed"
        ? { kind: "fixed", rawMaterialId: "", quantityUsed: line.quantityUsed }
        : { kind: "slot", groupId: "", quantityUsed: line.quantityUsed, defaultMemberId: null, allowSpecial: true }
    );
  }

  function fixedRow(line: FixedLineDraft, index: number) {
    const usedByOthers = new Set(
      lines.flatMap((l, i) => (i !== index && l.kind === "fixed" && l.rawMaterialId !== "" ? [l.rawMaterialId] : []))
    );
    const mat = materialById.get(line.rawMaterialId);
    const archived = mat?.archived === true;
    const unknown = line.rawMaterialId !== "" && !mat;
    return (
      <>
        <div className="flex items-center gap-2">
          <select
            aria-label="วัตถุดิบ"
            value={line.rawMaterialId}
            onChange={(e) => update(index, { ...line, rawMaterialId: e.target.value })}
            className={`${FIELD} min-w-0 flex-1 px-3`}
          >
            <option value="">— เลือกวัตถุดิบ —</option>
            {archived && (
              <option value={mat.id} disabled>
                {mat.name} (ปิดใช้แล้ว)
              </option>
            )}
            {unknown && (
              <option value={line.rawMaterialId} disabled>
                (วัตถุดิบที่ไม่พบ)
              </option>
            )}
            {active.map((m) => (
              <option key={m.id} value={m.id} disabled={usedByOthers.has(m.id)}>
                {m.name}
                {usedByOthers.has(m.id) ? " (มีในสูตรแล้ว)" : ""}
              </option>
            ))}
          </select>
          <QtyInput line={line} onChange={(q) => update(index, { ...line, quantityUsed: q })} />
          <span className="w-11 shrink-0 truncate text-[15px] text-muted-foreground">{mat?.unit ?? ""}</span>
          <RemoveButton onClick={() => remove(index)} />
        </div>
        {archived && (
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-sidebar">
            <span className={ARCHIVED_BADGE}>ปิดใช้แล้ว</span>
            ไม่หักสต๊อกตอนขาย — เลือกวัตถุดิบอื่นแทน หรือลบบรรทัดนี้
          </p>
        )}
      </>
    );
  }

  function slotRow(line: SlotLineDraft, index: number) {
    const group = groupById.get(line.groupId);
    const usedByOthers = new Set(
      lines.flatMap((l, i) => (i !== index && l.kind === "slot" && l.groupId !== "" ? [l.groupId] : []))
    );
    const ownDefault = group?.members.find((m) => m.id === line.defaultMemberId);
    const groupDefault = groupDefaultLabel(group);
    const special = group ? specialWord(group.kind) : "เมล็ดพิเศษ";
    return (
      <>
        <div className="flex items-center gap-2">
          <select
            aria-label="เมล็ด/มัทฉะ"
            value={line.groupId}
            onChange={(e) => update(index, { ...line, groupId: e.target.value, defaultMemberId: null })}
            className={`${FIELD} min-w-0 flex-1 px-3`}
          >
            <option value="">— เลือกเมล็ด/มัทฉะ —</option>
            {line.groupId !== "" && !group && (
              <option value={line.groupId} disabled>
                (กลุ่มที่ไม่พบ)
              </option>
            )}
            {groups.map((g) => (
              <option key={g.id} value={g.id} disabled={usedByOthers.has(g.id)}>
                {g.name}
                {usedByOthers.has(g.id) ? " (มีในสูตรแล้ว)" : ""}
              </option>
            ))}
          </select>
          <QtyInput line={line} onChange={(q) => update(index, { ...line, quantityUsed: q })} />
          <span className="w-11 shrink-0 truncate text-[15px] text-muted-foreground">{groupUnit(group)}</span>
          <RemoveButton onClick={() => remove(index)} />
        </div>
        {group && (
          <div className="space-y-3">
            <div>
              <label htmlFor={`slot-default-${index}`} className="mb-1 block text-[15px] font-medium text-sidebar">
                ค่าเริ่มต้นของเมนูนี้
              </label>
              <select
                id={`slot-default-${index}`}
                value={line.defaultMemberId ?? ""}
                onChange={(e) => update(index, { ...line, defaultMemberId: e.target.value === "" ? null : e.target.value })}
                className={`${FIELD} w-full px-3`}
              >
                <option value="">ใช้ค่าเริ่มต้นของกลุ่ม{groupDefault ? ` (${groupDefault})` : ""}</option>
                {line.defaultMemberId !== null && !ownDefault && (
                  <option value={line.defaultMemberId} disabled>
                    (ตัวเลือกที่ไม่พบ)
                  </option>
                )}
                {group.members.map((m) => {
                  const blocked = (m.tier === "special" && !line.allowSpecial) || (m.archived && m.id !== line.defaultMemberId);
                  return (
                    <option key={m.id} value={m.id} disabled={blocked}>
                      {m.label}
                      {m.tier === "special" ? ` · ${special}${m.priceDelta > 0 ? ` +${m.priceDelta}` : ""}` : ""}
                      {m.archived ? " (ปิดใช้แล้ว)" : ""}
                    </option>
                  );
                })}
              </select>
              {ownDefault?.archived && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-sidebar">
                  <span className={ARCHIVED_BADGE}>ปิดใช้แล้ว</span>
                  ขายจะใช้ค่าเริ่มต้นของกลุ่มแทน — เลือกตัวอื่นได้
                </p>
              )}
            </div>
            <label className="flex min-h-14 cursor-pointer items-center gap-3">
              <Switch
                checked={line.allowSpecial}
                onCheckedChange={(on) => {
                  // A special default cannot stay when specials are switched off.
                  const keep = on || ownDefault?.tier !== "special";
                  update(index, { ...line, allowSpecial: on, defaultMemberId: keep ? line.defaultMemberId : null });
                }}
              />
              <span className="text-[17px] text-sidebar">ให้เลือก{special}ได้</span>
            </label>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-input p-3">
          <div role="radiogroup" aria-label="ชนิดบรรทัด" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={line.kind === "fixed"}
              onClick={() => setKind(i, "fixed")}
              className={kindChip(line.kind === "fixed")}
            >
              {line.kind === "fixed" ? "✓ " : ""}วัตถุดิบ
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={line.kind === "slot"}
              disabled={groups.length === 0 && line.kind !== "slot"}
              onClick={() => setKind(i, "slot")}
              className={kindChip(line.kind === "slot")}
            >
              {line.kind === "slot" ? "✓ " : ""}เมล็ด/มัทฉะ (ให้ลูกค้าเลือก)
            </button>
          </div>
          {line.kind === "fixed" ? fixedRow(line, i) : slotRow(line, i)}
        </div>
      ))}
      {groups.length === 0 && (
        <p className="text-[15px] text-muted-foreground">
          ยังไม่มีกลุ่มเมล็ด/มัทฉะ —{" "}
          <Link href="/inventory/groups" className="font-medium text-accent hover:underline">
            ไปตั้งที่หน้ากลุ่มตัวเลือก
          </Link>
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange([...lines, { kind: "fixed", rawMaterialId: "", quantityUsed: "" }])}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-accent text-base font-semibold text-accent hover:bg-accent/5"
      >
        <Plus size={18} />
        เพิ่มบรรทัดสูตร
      </button>
    </div>
  );
}

function QtyInput({ line, onChange }: { line: RecipeLineDraft; onChange: (q: string) => void }) {
  return (
    <input
      aria-label="ปริมาณ"
      inputMode="decimal"
      value={line.quantityUsed}
      max={MAX_RECIPE_QTY}
      onChange={(e) => onChange(e.target.value)}
      placeholder="ปริมาณ"
      className={`${FIELD} w-[92px] shrink-0 px-3`}
    />
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="ลบบรรทัด"
      onClick={onClick}
      className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20"
    >
      <Trash2 size={20} />
    </button>
  );
}
