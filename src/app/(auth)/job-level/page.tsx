import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { OwnerTile } from "@/components/job-level/owner-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <OwnerTile hasPinSet={profile.pin_hash !== null} />
    </div>
  );
}
