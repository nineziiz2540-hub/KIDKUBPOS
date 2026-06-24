import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { updateStoreName } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ตั้งค่าร้านค้า</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          จัดการข้อมูลร้านของคุณ
        </p>
      </div>

      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ข้อมูลร้านค้า</h2>
        <StoreNameForm
          action={updateStoreName}
          defaultName={profile.tenants.name}
        />
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-sidebar">จัดการทีม</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              ดูและแก้ไข Role ของพนักงาน
            </p>
          </div>
          <Link
            href="/settings/team"
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Users size={16} />
            ดูทีมงาน
          </Link>
        </div>
      </div>
    </div>
  );
}
