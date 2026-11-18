import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { getProfile, getRawMaterials, getChoiceGroups, getSweetnessConfig } from "@/lib/dal";
import { GroupsManager } from "@/components/inventory/groups-manager";
import { SeedGroupsCard } from "@/components/inventory/seed-groups-card";
import { missingSeedGroups, missingSeedLevels } from "@/lib/stock/config-plan";

export default async function GroupsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const [groups, materials, sweetness] = await Promise.all([
    getChoiceGroups(profile.tenant_id),
    getRawMaterials(profile.tenant_id),
    getSweetnessConfig(profile.tenant_id),
  ]);

  const seedMissing =
    missingSeedGroups(groups.map((g) => ({ kind: g.kind, sort_order: 0 }))).length > 0 ||
    missingSeedLevels(
      sweetness.levels.map((l) => ({ name: l.name, is_none: l.isNone, is_default: l.isDefault, sort_order: 0 }))
    ).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-sidebar">
            <Layers size={24} />
            กลุ่มตัวเลือก
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">เมล็ดกาแฟ มัทฉะ และสารให้ความหวานที่ลูกค้าเลือกได้บน POS</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory/sweetness"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            ตารางความหวาน
          </Link>
          <Link
            href="/inventory"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            ← วัตถุดิบ
          </Link>
        </div>
      </div>

      {seedMissing && <SeedGroupsCard firstTime={groups.length === 0} />}

      {groups.length > 0 && (
        <GroupsManager
          groups={groups}
          materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, category: m.category }))}
        />
      )}
    </div>
  );
}
