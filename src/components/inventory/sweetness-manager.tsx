"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addSweetnessLevel,
  updateSweetnessLevel,
  setDefaultLevel,
  moveSweetnessLevel,
  saveStandardSweetness,
} from "@/app/actions/stock-config";
import { buildGrid, gridKey, gridToCells } from "@/lib/stock/config-plan";
import { useConfigAction } from "./use-config-action";

export type LevelProps = { id: string; name: string; isNone: boolean; isDefault: boolean };
export type SweetenerRow = { id: string; label: string; unit: string };
export type AmountProps = { member_id: string; level_id: string; amount: number };

const CHIP = "inline-flex h-14 items-center justify-center rounded-lg border px-4 text-base font-semibold";
const CHIP_ON = "border-accent bg-accent text-white";
const CHIP_OFF = "border-border bg-white text-sidebar hover:bg-muted";

function LevelRow({ level, index, count }: { level: LevelProps; index: number; count: number }) {
  const { run, busy } = useConfigAction();
  const [name, setName] = useState(level.name);
  const dirty = name.trim() !== level.name;

  return (
    <li className="space-y-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label="เลื่อนขึ้น"
            disabled={busy !== null || index === 0}
            onClick={() => run("up", () => moveSweetnessLevel(level.id, -1))}
            className="size-14"
          >
            <ArrowUp size={22} />
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="เลื่อนลง"
            disabled={busy !== null || index === count - 1}
            onClick={() => run("down", () => moveSweetnessLevel(level.id, 1))}
            className="size-14"
          >
            <ArrowDown size={22} />
          </Button>
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <label className="block text-sm text-muted-foreground" htmlFor={`lv-${level.id}`}>
            ชื่อระดับ
          </label>
          <input
            id={`lv-${level.id}`}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || level.isDefault}
          onClick={() => run("default", () => setDefaultLevel(level.id), "ตั้งเป็นค่าเริ่มต้นแล้ว")}
          className={`${CHIP} ${level.isDefault ? CHIP_ON : CHIP_OFF} disabled:opacity-100`}
        >
          {level.isDefault ? "✓ ค่าเริ่มต้น" : "ตั้งเป็นค่าเริ่มต้น"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          aria-pressed={level.isNone}
          onClick={() =>
            run(
              "none",
              () => updateSweetnessLevel(level.id, { name: level.name, isNone: !level.isNone }),
              level.isNone ? "เอาเครื่องหมาย “ไม่หวาน” ออกแล้ว" : "ตั้งเป็นระดับ “ไม่หวาน” แล้ว"
            )
          }
          className={`${CHIP} ${level.isNone ? CHIP_ON : CHIP_OFF}`}
        >
          {level.isNone ? "✓ ระดับไม่หวาน" : "ตั้งเป็นระดับไม่หวาน"}
        </Button>
      </div>
      {dirty && (
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => run("save", () => updateSweetnessLevel(level.id, { name, isNone: level.isNone }), "บันทึกแล้ว")}
          className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
        >
          {busy === "save" ? "กำลังบันทึก…" : "บันทึกชื่อ"}
        </Button>
      )}
    </li>
  );
}

function AddLevel() {
  const { run, busy } = useConfigAction();
  const [name, setName] = useState("");
  async function add() {
    const ok = await run("add", () => addSweetnessLevel(name), "เพิ่มระดับแล้ว");
    if (ok) setName("");
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed bg-white p-4">
      <div className="min-w-0 flex-1 basis-56">
        <label className="block text-sm text-muted-foreground" htmlFor="new-level">
          เพิ่มระดับความหวาน
        </label>
        <input
          id="new-level"
          value={name}
          maxLength={40}
          placeholder="เช่น หวานน้อยมาก"
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-14 w-full rounded-lg border bg-white px-3 text-lg text-sidebar"
        />
      </div>
      <Button
        type="button"
        disabled={busy !== null || name.trim() === ""}
        onClick={add}
        className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
      >
        {busy === "add" ? "กำลังเพิ่ม…" : "+ เพิ่ม"}
      </Button>
    </div>
  );
}

/**
 * The sweetener × level amount grid. Shared by the shop's standard table (below) and the menu editor's
 * "ใช้ปริมาณเฉพาะเมนูนี้" table. The ไม่หวาน column is always 0 and not editable.
 */
export function SweetnessGridTable({
  sweeteners,
  levels,
  grid,
  onChange,
}: {
  sweeteners: SweetenerRow[];
  levels: Pick<LevelProps, "id" | "name" | "isNone">[];
  grid: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-base">
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-sidebar">สารให้ความหวาน (หน่วย)</th>
            {levels.map((l) => (
              <th key={l.id} className="px-3 py-3 text-center font-medium text-sidebar">
                {l.name}
                {l.isNone && <span className="block text-xs font-normal text-muted-foreground">ไม่ใช้ = 0</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sweeteners.map((s) => (
            <tr key={s.id} className="border-b last:border-b-0">
              <th scope="row" className="px-4 py-2 text-left font-medium text-sidebar">
                {s.label} ({s.unit})
              </th>
              {levels.map((l) => {
                const k = gridKey(s.id, l.id);
                return (
                  <td key={l.id} className="px-2 py-2">
                    {l.isNone ? (
                      <div className="flex h-14 min-w-24 items-center justify-center rounded-lg border bg-muted/30 text-lg text-muted-foreground">
                        0
                      </div>
                    ) : (
                      <input
                        aria-label={`${s.label} · ${l.name}`}
                        inputMode="decimal"
                        value={grid[k] ?? ""}
                        placeholder="—"
                        onChange={(e) => onChange(k, e.target.value)}
                        className="h-14 w-full min-w-24 rounded-lg border bg-white px-2 text-center text-lg text-sidebar"
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandardGrid({
  sweeteners,
  levels,
  amounts,
}: {
  sweeteners: SweetenerRow[];
  levels: LevelProps[];
  amounts: AmountProps[];
}) {
  const { run, busy, toast } = useConfigAction();
  const [grid, setGrid] = useState(() => buildGrid(sweeteners, levels, amounts));

  async function save() {
    const out = gridToCells(sweeteners, levels, grid);
    if ("error" in out) {
      toast.add({ title: out.error, type: "error" });
      return;
    }
    await run("grid", () => saveStandardSweetness(out.cells), "บันทึกตารางความหวานแล้ว");
  }

  return (
    <div className="space-y-3">
      <SweetnessGridTable
        sweeteners={sweeteners}
        levels={levels}
        grid={grid}
        onChange={(k, v) => setGrid((g) => ({ ...g, [k]: v }))}
      />
      <Button
        type="button"
        disabled={busy !== null}
        onClick={save}
        className="h-14 bg-accent px-8 text-base font-semibold text-white hover:bg-accent/90"
      >
        {busy === "grid" ? "กำลังบันทึก…" : "บันทึกตารางความหวาน"}
      </Button>
    </div>
  );
}

export function SweetnessManager({
  levels,
  sweeteners,
  amounts,
}: {
  levels: LevelProps[];
  sweeteners: SweetenerRow[];
  amounts: AmountProps[];
}) {
  // Re-key the grid whenever the saved data or the shape changes, so it always shows what is saved.
  const gridKeyStr = JSON.stringify([
    levels.map((l) => [l.id, l.name, l.isNone]),
    sweeteners.map((s) => [s.id, s.label, s.unit]),
    amounts,
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-sidebar">ระดับความหวาน</h2>
          <p className="text-sm text-muted-foreground">
            ตั้งชื่อและลำดับเอง — มีค่าเริ่มต้นได้ 1 ระดับ และระดับ “ไม่หวาน” ได้ 1 ระดับ
          </p>
        </div>
        {levels.length === 0 ? (
          <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">ยังไม่มีระดับความหวาน</p>
        ) : (
          <ul className="space-y-3">
            {levels.map((l, i) => (
              <LevelRow key={`${l.id}-${l.name}`} level={l} index={i} count={levels.length} />
            ))}
          </ul>
        )}
        <AddLevel />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-sidebar">ตารางความหวานมาตรฐานของร้าน</h2>
          <p className="text-sm text-muted-foreground">
            กรอกครั้งเดียว ใช้ทุกเมนู — ปริมาณจริงในหน่วยของแต่ละสารให้ความหวาน เช่น ไซรัป 0 / 10 / 20 / 35 ml
          </p>
        </div>
        {sweeteners.length === 0 || levels.length === 0 ? (
          <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
            {sweeteners.length === 0
              ? "ยังไม่มีสารให้ความหวาน — เพิ่มวัตถุดิบในกลุ่ม “ความหวาน” ที่หน้ากลุ่มตัวเลือกก่อน"
              : "ยังไม่มีระดับความหวาน — เพิ่มระดับด้านบนก่อน"}
          </p>
        ) : (
          <StandardGrid key={gridKeyStr} sweeteners={sweeteners} levels={levels} amounts={amounts} />
        )}
      </section>
    </div>
  );
}
