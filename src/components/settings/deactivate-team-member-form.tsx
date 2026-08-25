"use client";
import { useActionState } from "react";
import {
  deactivateTeamMember,
  reactivateTeamMember,
  type TeamMemberState,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";

export function DeactivateButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    deactivateTeamMember,
    undefined
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        {pending ? "…" : "ปิดใช้งาน"}
      </Button>
      {state?.error !== undefined && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

export function ReactivateButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    reactivateTeamMember,
    undefined
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "…" : "เปิดใช้งานอีกครั้ง"}
      </Button>
      {state?.error !== undefined && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}
