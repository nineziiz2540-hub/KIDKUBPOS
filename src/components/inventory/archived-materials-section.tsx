"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToastManager } from "@/components/ui/toast";
import { unarchiveRawMaterial } from "@/app/actions/inventory";

export type ArchivedMaterial = { id: string; name: string; category: string };

function EnableButton({ id, name }: { id: string; name: string }) {
  const toast = useToastManager();
  const [pending, setPending] = useState(false);

  async function enable() {
    setPending(true);
    const fd = new FormData();
    fd.set("id", id);
    const result = await unarchiveRawMaterial(fd);
    setPending(false);
    toast.add(
      result?.error
        ? { title: result.error, type: "error" }
        : { title: `เปิดใช้อีกครั้ง: ${name}`, type: "success" }
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={enable}
      className="h-14 px-5 text-base font-semibold"
    >
      {pending ? "กำลังเปิดใช้…" : "เปิดใช้อีกครั้ง"}
    </Button>
  );
}

/** Same disclosure pattern as the deactivated-staff section in Settings > ทีมงาน. */
export function ArchivedMaterialsSection({ materials }: { materials: ArchivedMaterial[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-2 px-4 py-3 text-base font-medium text-sidebar"
      >
        <span>ปิดใช้แล้ว ({materials.length})</span>
        {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
      </button>
      {open && (
        <div className="divide-y divide-border border-t">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-4 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.category}</p>
              </div>
              <EnableButton id={m.id} name={m.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
