"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TeamMember } from "@/lib/dal";
import { ReactivateButton } from "@/components/settings/deactivate-team-member-form";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export function DeactivatedMembersSection({ members }: { members: TeamMember[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-sidebar"
      >
        <span>พนักงานที่ปิดใช้งานแล้ว ({members.length})</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="divide-y divide-border border-t">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar text-sm truncate">
                  {member.full_name ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[member.role] ?? member.role}
                  {member.deactivated_at &&
                    ` · ปิดใช้งานแล้วเมื่อ ${new Date(member.deactivated_at).toLocaleDateString("th-TH")}`}
                </p>
              </div>
              <ReactivateButton memberId={member.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
