import Link from "next/link";
import { redirect } from "next/navigation";
import { Candy } from "lucide-react";
import { getProfile, getChoiceGroups, getSweetnessConfig } from "@/lib/dal";
import { SweetnessManager } from "@/components/inventory/sweetness-manager";
import { SeedGroupsCard } from "@/components/inventory/seed-groups-card";
import { missingSeedGroups, missingSeedLevels } from "@/lib/stock/config-plan";

export default async function SweetnessPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const [groups, { levels, amounts }] = await Promise.all([
    getChoiceGroups(profile.tenant_id),
    getSweetnessConfig(profile.tenant_id),
  ]);

  const seedMissing =
    missingSeedGroups(groups.map((g) => ({ kind: g.kind, sort_order: 0 }))).length > 0 ||
    missingSeedLevels(
      levels.map((l) => ({ name: l.name, is_none: l.isNone, is_default: l.isDefault, sort_order: 0 }))
    ).length > 0;

  const sweeteners = groups
    .filter((g) => g.kind === "sweetener")
    .flatMap((g) => g.members)
    .map((m) => ({ id: m.id, label: m.label, unit: m.unit }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-sidebar">
            <Candy size={24} />
            ตารางความหวาน
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">ระดับความหวานและปริมาณที่ใช้ของแต่ละสารให้ความหวาน</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory/groups"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            กลุ่มตัวเลือก
          </Link>
          <Link
            href="/inventory"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            ← วัตถุดิบ
          </Link>
        </div>
      </div>

      {seedMissing && <SeedGroupsCard firstTime={groups.length === 0 && levels.length === 0} />}

      <SweetnessManager levels={levels} sweeteners={sweeteners} amounts={amounts} />
    </div>
  );
}
