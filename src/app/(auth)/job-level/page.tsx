import { redirect } from "next/navigation";
import { getProfile, getTeamMembersByRole } from "@/lib/dal";
import { SelfTile } from "@/components/job-level/self-tile";
import { RoleTile } from "@/components/job-level/role-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "owner" && !profile.has_backup_password) {
    redirect("/onboarding/set-password");
  }

  const [owners, managers, staff] = await Promise.all([
    getTeamMembersByRole(profile.tenant_id, "owner", profile.id),
    getTeamMembersByRole(profile.tenant_id, "manager", profile.id),
    getTeamMembersByRole(profile.tenant_id, "staff", profile.id),
  ]);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <SelfTile role={profile.role} hasPinSet={profile.pin_hash !== null} />
      {profile.role !== "owner" && <RoleTile label="OWNER" members={owners} />}
      <RoleTile label="MANAGER" members={managers} />
      <RoleTile label="STAFF" members={staff} />
    </div>
  );
}
