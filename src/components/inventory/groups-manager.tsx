"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addGroupMember,
  updateGroupMember,
  setDefaultMember,
  moveGroupMember,
  checkGroupMemberRemoval,
  removeGroupMember,
} from "@/app/actions/stock-config";
import { tierWord } from "@/lib/stock/config-plan";
import { useConfigAction } from "./use-config-action";

export type GroupMemberProps = {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  label: string;
  tier: "house" | "special";
  priceDelta: number;
  isDefault: boolean;
  archived: boolean;
};
export type GroupProps = {
  id: string;
  kind: "bean" | "matcha" | "sweetener" | "other";
  name: string;
  members: GroupMemberProps[];
};
export type PickableMaterial = { id: string; name: string; unit: string; category: string };

const KIND_WORD: Record<GroupProps["kind"], string> = {
  bean: "เมล็ดกาแฟ",
  matcha: "มัทฉะ",
  sweetener: "สารให้ความหวาน",
  other: "อื่น ๆ",
};

const CHIP = "inline-flex h-14 items-center justify-center rounded-lg border px-4 text-base font-semibold";
const CHIP_ON = "border-accent bg-accent text-white";
const CHIP_OFF = "border-border bg-white text-sidebar hover:bg-muted";

/**
 * "นำออกจากกลุ่ม": one tap checks; a blocked member says why, a plain one goes at once, and one that is a
 * menu's default shows the warning with a confirm button (second tap) and a cancel.
 */
function RemoveControl({ memberId }: { memberId: string }) {
  const { run, busy } = useConfigAction();
  const [warn, setWarn] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function firstTap() {
    setBlocked(null);
    let state: Awaited<ReturnType<typeof checkGroupMemberRemoval>> = {};
    const ok = await run("check", async () => {
      try {
        state = await checkGroupMemberRemoval(memberId);
      } catch {
        return { error: "ตรวจสอบไม่สำเร็จ — ลองอีกครั้ง" };
      }
      return state.error ? { error: state.error } : { success: true };
    });
    if (!ok) return;
    if (state.blocked) {
      setBlocked(state.blocked);
      return;
    }
    if (state.warn) {
      setWarn(state.warn);
      return;
    }
    await run("remove", () => removeGroupMember(memberId), "นำออกจากกลุ่มแล้ว");
  }

  async function confirm() {
    const ok = await run("remove", () => removeGroupMember(memberId), "นำออกจากกลุ่มแล้ว");
    if (!ok) setWarn(null);
  }

  if (warn) {
    return (
      <div className="space-y-3 rounded-lg border border-warning bg-warning/10 p-4">
        <p className="text-base font-semibold text-sidebar">{warn}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy !== null}
            onClick={confirm}
            className="h-14 bg-destructive px-6 text-base font-semibold text-white hover:bg-destructive/90"
          >
            {busy === "remove" ? "กำลังนำออก…" : "ยืนยันนำออก"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setWarn(null)}
            className="h-14 px-6 text-base font-semibold"
          >
            ไม่นำออก
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy !== null}
        onClick={firstTap}
        className="h-14 border-destructive px-6 text-base font-semibold text-destructive hover:bg-muted"
      >
        {busy === "check" || busy === "remove" ? "กำลังตรวจสอบ…" : "นำออกจากกลุ่ม"}
      </Button>
      {blocked && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          นำออกไม่ได้ — {blocked}
        </p>
      )}
    </div>
  );
}

function MemberRow({
  member,
  kind,
  index,
  count,
}: {
  member: GroupMemberProps;
  kind: GroupProps["kind"];
  index: number;
  count: number;
}) {
  const { run, busy } = useConfigAction();
  const [label, setLabel] = useState(member.label);
  const [tier, setTier] = useState(member.tier);
  const [price, setPrice] = useState(member.priceDelta === 0 ? "" : String(member.priceDelta));
  const isSweetener = kind === "sweetener";

  const priceNumber = tier === "special" && price.trim() !== "" ? Number(price) : 0;
  const dirty =
    label.trim() !== member.label ||
    tier !== member.tier ||
    (tier === "special" && priceNumber !== member.priceDelta);

  async function save() {
    if (!Number.isFinite(priceNumber)) {
      await run("bad-price", async () => ({ error: "ราคาเพิ่มใส่เป็นตัวเลข" }));
      return;
    }
    await run("save", () => updateGroupMember(member.id, { label, tier, priceDelta: priceNumber }), "บันทึกแล้ว");
  }

  return (
    <li className="space-y-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label="เลื่อนขึ้น"
            disabled={busy !== null || index === 0}
            onClick={() => run("up", () => moveGroupMember(member.id, -1))}
            className="size-14"
          >
            <ArrowUp size={22} />
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="เลื่อนลง"
            disabled={busy !== null || index === count - 1}
            onClick={() => run("down", () => moveGroupMember(member.id, 1))}
            className="size-14"
          >
            <ArrowDown size={22} />
          </Button>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <label className="block text-sm text-muted-foreground" htmlFor={`label-${member.id}`}>
            ชื่อที่โชว์บน POS
          </label>
          <input
            id={`label-${member.id}`}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            วัตถุดิบ: {member.materialName} ({member.unit})
            {member.archived && <span className="ml-2 font-semibold text-warning">ปิดใช้แล้ว</span>}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || member.isDefault}
          onClick={() => run("default", () => setDefaultMember(member.id), "ตั้งเป็นค่าเริ่มต้นแล้ว")}
          className={`${CHIP} ${member.isDefault ? CHIP_ON : CHIP_OFF} disabled:opacity-100`}
        >
          {member.isDefault ? "✓ ค่าเริ่มต้น" : "ตั้งเป็นค่าเริ่มต้น"}
        </Button>
      </div>

      {!isSweetener && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2" role="group" aria-label="ประเภท">
            {(["house", "special"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                onClick={() => setTier(t)}
                className={`${CHIP} ${tier === t ? CHIP_ON : CHIP_OFF}`}
              >
                {tier === t ? "✓ " : ""}
                {tierWord(kind, t)}
              </button>
            ))}
          </div>
          {tier === "special" && (
            <div>
              <label className="block text-sm text-muted-foreground" htmlFor={`price-${member.id}`}>
                ราคาเพิ่ม (บาท)
              </label>
              <input
                id={`price-${member.id}`}
                inputMode="decimal"
                value={price}
                placeholder="0"
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 h-14 w-36 rounded-lg border bg-white px-3 text-lg text-sidebar"
              />
            </div>
          )}
        </div>
      )}

      <RemoveControl memberId={member.id} />

      {dirty && (
        <Button
          type="button"
          disabled={busy !== null}
          onClick={save}
          className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
        >
          {busy === "save" ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      )}
    </li>
  );
}

function AddMember({ group, materials }: { group: GroupProps; materials: PickableMaterial[] }) {
  const { run, busy } = useConfigAction();
  const [materialId, setMaterialId] = useState("");
  const taken = new Set(group.members.map((m) => m.materialId));
  const options = materials.filter((m) => !taken.has(m.id));
  const categories = Array.from(new Set(options.map((o) => o.category)));

  async function add() {
    if (!materialId) return;
    const ok = await run("add", () => addGroupMember(group.id, materialId), "เพิ่มแล้ว");
    if (ok) setMaterialId("");
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed bg-white p-4">
      <div className="min-w-0 flex-1 basis-64">
        <label className="block text-sm text-muted-foreground" htmlFor={`add-${group.id}`}>
          เพิ่มวัตถุดิบเข้ากลุ่ม
        </label>
        <select
          id={`add-${group.id}`}
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
          className="mt-1 h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar"
        >
          <option value="">{options.length === 0 ? "ไม่มีวัตถุดิบให้เพิ่ม" : "เลือกวัตถุดิบ…"}</option>
          {categories.map((c) => (
            <optgroup key={c} label={c}>
              {options
                .filter((o) => o.category === c)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.unit})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <Button
        type="button"
        disabled={busy !== null || !materialId}
        onClick={add}
        className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
      >
        {busy === "add" ? "กำลังเพิ่ม…" : "+ เพิ่ม"}
      </Button>
    </div>
  );
}

export function GroupsManager({ groups, materials }: { groups: GroupProps[]; materials: PickableMaterial[] }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.id} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-sidebar">
              {g.name} <span className="text-sm font-normal text-muted-foreground">({KIND_WORD[g.kind]})</span>
            </h2>
            {g.kind === "sweetener" && (
              <p className="text-sm text-muted-foreground">ตัวร้านเท่านั้น ไม่คิดราคาเพิ่ม — ปริมาณแต่ละระดับตั้งที่หน้าตารางความหวาน</p>
            )}
          </div>
          {g.members.length === 0 ? (
            <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
              ยังไม่มีตัวเลือกในกลุ่มนี้ — เลือกวัตถุดิบด้านล่างเพื่อเพิ่ม
            </p>
          ) : (
            <ul className="space-y-3">
              {g.members.map((m, i) => (
                <MemberRow
                  key={`${m.id}-${m.label}-${m.tier}-${m.priceDelta}`}
                  member={m}
                  kind={g.kind}
                  index={i}
                  count={g.members.length}
                />
              ))}
            </ul>
          )}
          <AddMember group={g} materials={materials} />
        </section>
      ))}
    </div>
  );
}
