"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import type { Role } from "@/lib/dal";

type Props = {
  action: (
    prevState: SettingsState,
    formData: FormData
  ) => Promise<SettingsState>;
  memberId: string;
  currentRole: Role;
};

export function RoleSelectForm({ action, memberId, currentRole }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <select
        name="role"
        defaultValue={currentRole}
        disabled={pending}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (form) form.requestSubmit();
        }}
        className="text-xs rounded border border-input bg-transparent px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="staff">Staff</option>
      </select>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}
