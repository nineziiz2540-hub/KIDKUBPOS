"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import type { Role } from "@/lib/dal";
import { SelfTileTrigger, SelfPinContent, ROLE_LABELS } from "@/components/job-level/self-tile";
import { RoleTile, MemberPinForm } from "@/components/job-level/role-tile";

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
          <Dialog.Popup
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => {
              // The popup itself fills the screen (needed to center its content), so a click
              // anywhere in that empty space is technically "inside" it from base-ui's
              // perspective and never counts as an outside press — this is the fix for that:
              // only close when the click lands on the popup element itself, not a descendant.
              if (e.target === e.currentTarget) setActive(null);
            }}
          >
            <div className="w-full max-w-sm space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="w-7" aria-hidden="true" />
                <Dialog.Title className="text-sm font-medium text-white">
                  {active?.type === "self" ? ROLE_LABELS[selfRole] : active?.label}
                </Dialog.Title>
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  aria-label="ปิด"
                  className="rounded-full p-1 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
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
