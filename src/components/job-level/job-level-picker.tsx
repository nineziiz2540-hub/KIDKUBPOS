"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { Role } from "@/lib/dal";
import { SelfTileTrigger, SelfPinContent } from "@/components/job-level/self-tile";
import { RoleTile, MemberPinForm } from "@/components/job-level/role-tile";

const ROLE_LABELS: Record<Role, string> = {
  owner: "OWNER",
  manager: "MANAGER",
  staff: "STAFF",
};

type Member = { id: string; full_name: string | null };

type Active = { type: "self" } | { type: "member"; id: string; label: string };

export function JobLevelPicker({
  selfRole,
  hasPinSet,
  roleGroups,
}: {
  selfRole: Role;
  hasPinSet: boolean;
  roleGroups: { label: string; members: Member[] }[];
}) {
  const [active, setActive] = useState<Active | null>(null);

  return (
    <>
      <SelfTileTrigger role={selfRole} onOpen={() => setActive({ type: "self" })} />
      {roleGroups.map((group) => (
        <RoleTile
          key={group.label}
          label={group.label}
          members={group.members}
          onSelect={(id, memberLabel) => setActive({ type: "member", id, label: memberLabel })}
        />
      ))}

      <Dialog.Root
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm space-y-2">
              <Dialog.Title className="text-center text-sm font-medium text-white">
                {active?.type === "self" ? ROLE_LABELS[selfRole] : active?.label}
              </Dialog.Title>
              {active?.type === "self" && (
                <SelfPinContent role={selfRole} hasPinSet={hasPinSet} />
              )}
              {active?.type === "member" && <MemberPinForm memberId={active.id} />}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
