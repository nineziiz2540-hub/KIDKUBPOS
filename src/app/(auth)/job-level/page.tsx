import { redirect } from "next/navigation";
import { getProfile, getTeamMembersByRole } from "@/lib/dal";
import { JobLevelPicker } from "@/components/job-level/job-level-picker";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "owner" && !profile.has_backup_password) {
    redirect("/onboarding/set-password");
  }

  const [owners, managers, staff] = await Promise.all([
    profile.role !== "owner"
      ? getTeamMembersByRole(profile.tenant_id, "owner", profile.id)
      : Promise.resolve([]),
    getTeamMembersByRole(profile.tenant_id, "manager", profile.id),
    getTeamMembersByRole(profile.tenant_id, "staff", profile.id),
  ]);

  const roleGroups = [
    ...(profile.role !== "owner" ? [{ label: "OWNER", members: owners }] : []),
    { label: "MANAGER", members: managers },
    { label: "STAFF", members: staff },
  ];

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <JobLevelPicker
        selfRole={profile.role}
        hasPinSet={profile.pin_hash !== null}
        roleGroups={roleGroups}
      />
    </div>
  );
}
