"use client";
import { useActionState, useState } from "react";
import { switchToMember, type PinState } from "@/app/actions/job-level";
import { PinPad } from "@/components/ui/pin-pad";
import { Card, CardContent } from "@/components/ui/card";

export function RoleTile({
  label,
  members,
}: {
  label: string;
  members: { id: string; full_name: string | null }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<PinState, FormData>(
    switchToMember,
    undefined
  );

  if (members.length === 0) {
    return (
      <div className="w-full rounded-lg border bg-white/50 p-6 text-center opacity-50">
        <p className="text-lg font-semibold text-sidebar">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">
          ให้ Owner เพิ่มพนักงานที่ตั้งค่า &gt; ทีมงาน
        </p>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="w-full rounded-lg border bg-white p-4 space-y-2">
        <p className="text-lg font-semibold text-sidebar text-center">{label}</p>
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m.id)}
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors"
          >
            {m.full_name ?? "—"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={setFormRef} action={action} className="flex flex-col items-center gap-4">
          <input type="hidden" name="member_id" value={selected} />
          <input type="hidden" name="pin" />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <PinPad
            disabled={pending}
            onComplete={(pin) => {
              if (!formRef) return;
              const hidden = formRef.elements.namedItem("pin") as HTMLInputElement;
              hidden.value = pin;
              formRef.requestSubmit();
            }}
          />
        </form>
      </CardContent>
    </Card>
  );
}
