import { redirect } from "next/navigation";
import { getProfile, getTeamMembersByRole } from "@/lib/dal";
import { OwnerTile } from "@/components/job-level/owner-tile";
import { RoleTile } from "@/components/job-level/role-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const [managers, staff] = await Promise.all([
    getTeamMembersByRole(profile.tenant_id, "manager"),
    getTeamMembersByRole(profile.tenant_id, "staff"),
  ]);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <OwnerTile hasPinSet={profile.pin_hash !== null} />
      <RoleTile label="MANAGER" members={managers} />
      <RoleTile label="STAFF" members={staff} />
    </div>
  );
}
