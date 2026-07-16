"use client";
import { useActionState, useEffect, useState } from "react";
import { resetTeamMemberPin, type TeamMemberState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPinForm({ memberId }: { memberId: string }) {
  const [formInstance, setFormInstance] = useState<number | null>(null);

  if (formInstance !== null) {
    return (
      <ResetPinFormInner
        key={formInstance}
        memberId={memberId}
        onDone={() => setFormInstance(null)}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setFormInstance((n) => (n ?? 0) + 1)}
    >
      ตั้ง PIN ใหม่
    </Button>
  );
}

function ResetPinFormInner({
  memberId,
  onDone,
}: {
  memberId: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    resetTeamMemberPin,
    undefined
  );

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => onDone(), 1500);
      return () => clearTimeout(timer);
    }
  }, [state?.success, onDone]);

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
      {state?.success && (
        <p className="text-xs text-success">ตั้ง PIN ใหม่สำเร็จ</p>
      )}
    </form>
  );
}
