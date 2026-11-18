"use client";
import { useRef } from "react";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { SweetnessGridTable } from "@/components/inventory/sweetness-manager";
import { fillSweetnessGrid, menuSweeteners, type SweetnessDraft } from "@/lib/menu-draft";
import type { EditorAmount, EditorGroup, EditorLevel } from "./menu-editor-types";

const LABEL = "mb-2 block text-base font-medium text-sidebar";
const CHIP_GRID = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]";

function chip(selected: boolean) {
  return `h-14 truncate rounded-xl border px-3 text-base transition-colors disabled:opacity-50 ${
    selected ? "border-accent bg-accent font-semibold text-white" : "border-input bg-white text-sidebar hover:border-accent"
  }`;
}

/** The "ความหวาน" section of a menu: which sweetener by default, which others, the default level, own table. */
export function MenuSweetnessEditor({
  value,
  onChange,
  groups,
  levels,
  standardAmounts,
}: {
  value: SweetnessDraft | null;
  onChange: (v: SweetnessDraft | null) => void;
  /** the shop's sweetener groups */
  groups: EditorGroup[];
  levels: EditorLevel[];
  standardAmounts: EditorAmount[];
}) {
  // Switching sweetness off and on again in the same visit brings the last settings back.
  const lastOn = useRef<SweetnessDraft | null>(value);
  const usable = groups.filter((g) => g.members.some((m) => !m.archived));

  function set(next: SweetnessDraft | null) {
    if (next) {
      // A table the owner uses always has a cell for every sweetener × level.
      if (next.useCustom) next = { ...next, custom: fillSweetnessGrid(next.custom, menuSweeteners(next), levels, standardAmounts) };
      lastOn.current = next;
    }
    onChange(next);
  }

  function fresh(group: EditorGroup): SweetnessDraft {
    const live = group.members.filter((m) => !m.archived);
    const def = live.find((m) => m.isDefault) ?? live[0]!;
    return { groupId: group.id, defaultMemberId: def.id, allowedMemberIds: [], defaultLevelId: null, useCustom: false, custom: {} };
  }

  if (usable.length === 0 && value === null) {
    return (
      <p className="text-base text-muted-foreground">
        ยังไม่มีสารให้ความหวาน —{" "}
        <Link href="/inventory/groups" className="font-medium text-accent hover:underline">
          ไปตั้งที่หน้ากลุ่มตัวเลือก
        </Link>
      </p>
    );
  }

  const group = value ? groups.find((g) => g.id === value.groupId) : undefined;
  const shopDefault = levels.find((l) => l.isDefault)?.name ?? null;
  const memberLabel = (id: string) => {
    const m = group?.members.find((x) => x.id === id);
    return m ? `${m.label}${m.archived ? " (ปิดใช้แล้ว)" : ""}` : "(ตัวเลือกที่ไม่พบ)";
  };

  return (
    <div className="space-y-5">
      <label className="flex min-h-14 cursor-pointer items-center gap-3">
        <Switch
          checked={value !== null}
          onCheckedChange={(on) => {
            if (!on) return onChange(null);
            const back = lastOn.current;
            if (back && groups.some((g) => g.id === back.groupId)) return set(back);
            if (usable[0]) set(fresh(usable[0]));
          }}
        />
        <span className="text-[17px] text-sidebar">ให้ลูกค้าเลือกความหวานได้</span>
      </label>

      {value && (
        <>
          {groups.length > 1 && (
            <div>
              <span className={LABEL}>กลุ่มสารให้ความหวาน</span>
              <div className={CHIP_GRID} role="radiogroup" aria-label="กลุ่มสารให้ความหวาน">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={g.id === value.groupId}
                    disabled={!usable.includes(g)}
                    onClick={() => g.id !== value.groupId && set(fresh(g))}
                    className={chip(g.id === value.groupId)}
                  >
                    {g.id === value.groupId ? "✓ " : ""}
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className={LABEL}>ชนิดเริ่มต้น</span>
            <div className={CHIP_GRID} role="radiogroup" aria-label="ชนิดเริ่มต้น">
              {!group && (
                <button type="button" role="radio" aria-checked className={chip(true)}>
                  ✓ (ตัวเลือกที่ไม่พบ)
                </button>
              )}
              {group?.members
                .filter((m) => !m.archived || m.id === value.defaultMemberId)
                .map((m) => {
                  const on = m.id === value.defaultMemberId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() =>
                        set({ ...value, defaultMemberId: m.id, allowedMemberIds: value.allowedMemberIds.filter((a) => a !== m.id) })
                      }
                      className={chip(on)}
                    >
                      {on ? "✓ " : ""}
                      {memberLabel(m.id)}
                    </button>
                  );
                })}
            </div>
          </div>

          <div>
            <span className={LABEL}>เปลี่ยนชนิดได้</span>
            <div className={CHIP_GRID} role="group" aria-label="เปลี่ยนชนิดได้">
              {group?.members
                .filter((m) => m.id !== value.defaultMemberId && (!m.archived || value.allowedMemberIds.includes(m.id)))
                .map((m) => {
                  const on = value.allowedMemberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() =>
                        set({
                          ...value,
                          allowedMemberIds: on
                            ? value.allowedMemberIds.filter((a) => a !== m.id)
                            : [...value.allowedMemberIds, m.id],
                        })
                      }
                      className={chip(on)}
                    >
                      {on ? "✓ " : ""}
                      {memberLabel(m.id)}
                    </button>
                  );
                })}
            </div>
            <p className="mt-2 text-[15px] text-muted-foreground">ไม่ติ๊กเลย = หน้า POS ไม่แสดงแถว “หวานด้วย”</p>
          </div>

          <div>
            <span className={LABEL}>ระดับเริ่มต้น</span>
            <div className={CHIP_GRID} role="radiogroup" aria-label="ระดับเริ่มต้น">
              <button
                type="button"
                role="radio"
                aria-checked={value.defaultLevelId === null}
                onClick={() => set({ ...value, defaultLevelId: null })}
                className={chip(value.defaultLevelId === null)}
              >
                {value.defaultLevelId === null ? "✓ " : ""}ตามร้าน{shopDefault ? ` (${shopDefault})` : ""}
              </button>
              {value.defaultLevelId !== null && !levels.some((l) => l.id === value.defaultLevelId) && (
                <button type="button" role="radio" aria-checked className={chip(true)}>
                  ✓ (ระดับที่ไม่พบ)
                </button>
              )}
              {levels.map((l) => {
                const on = l.id === value.defaultLevelId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set({ ...value, defaultLevelId: l.id })}
                    className={chip(on)}
                  >
                    {on ? "✓ " : ""}
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex min-h-14 cursor-pointer items-center gap-3">
              <Switch checked={value.useCustom} onCheckedChange={(on) => set({ ...value, useCustom: on })} />
              <span className="text-[17px] text-sidebar">ใช้ปริมาณเฉพาะเมนูนี้</span>
            </label>
            {value.useCustom &&
              (levels.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">ยังไม่มีระดับความหวาน — เพิ่มที่หน้าตารางความหวานก่อน</p>
              ) : (
                <>
                  <p className="text-[15px] text-muted-foreground">ใช้ตารางนี้แทนตารางมาตรฐานของร้าน เฉพาะเมนูนี้</p>
                  <SweetnessGridTable
                    sweeteners={menuSweeteners(value).map((id) => {
                      const m = group?.members.find((x) => x.id === id);
                      return { id, label: memberLabel(id), unit: m?.unit ?? "" };
                    })}
                    levels={levels}
                    grid={value.custom}
                    onChange={(k, v) => set({ ...value, custom: { ...value.custom, [k]: v } })}
                  />
                </>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
