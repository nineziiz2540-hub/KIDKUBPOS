import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getProfile, getTeamMembers } from "@/lib/dal";
import { updateMemberRole } from "@/app/actions/settings";
import { RoleSelectForm } from "@/components/settings/role-select-form";
import { TeamMemberForm } from "@/components/settings/team-member-form";
import { ResetPinForm } from "@/components/settings/reset-pin-form";
import { DeactivateButton } from "@/components/settings/deactivate-team-member-form";
import { DeactivatedMembersSection } from "@/components/settings/deactivated-members-section";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export default async function TeamPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const members = await getTeamMembers(profile.tenant_id);
  const activeMembers = members.filter((m) => m.deactivated_at === null);
  const deactivatedMembers = members.filter((m) => m.deactivated_at !== null);

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-sidebar transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-sidebar">จัดการทีม</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeMembers.length} คนในร้าน
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {activeMembers.map((member) => (
          <div key={member.id} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm truncate">
                {member.full_name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[member.role] ?? member.role}
              </p>
            </div>
            {member.id === profile.id ? (
              <span className="text-xs text-muted-foreground italic px-2 py-1">
                คุณ
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <RoleSelectForm
                  action={updateMemberRole}
                  memberId={member.id}
                  currentRole={member.role}
                />
                <ResetPinForm memberId={member.id} />
                <DeactivateButton memberId={member.id} />
              </div>
            )}
          </div>
        ))}
        {activeMembers.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ยังไม่มีพนักงาน
          </p>
        )}
      </div>

      {deactivatedMembers.length > 0 && (
        <DeactivatedMembersSection members={deactivatedMembers} />
      )}

      <TeamMemberForm />
    </div>
  );
}
