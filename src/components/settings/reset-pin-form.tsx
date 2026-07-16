"use client";
import { useActionState, useState } from "react";
import { resetTeamMemberPin, type TeamMemberState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPinForm({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    resetTeamMemberPin,
    undefined
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        ตั้ง PIN ใหม่
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Input
        name="pin"
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="PIN ใหม่"
        required
        className="w-24"
      />
      <Input
        name="pin_confirm"
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="ยืนยัน"
        required
        className="w-24"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : "บันทึก"}
      </Button>
      {state?.error !== undefined && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}
