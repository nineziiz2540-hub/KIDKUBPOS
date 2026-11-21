import Link from "next/link";
import { redirect } from "next/navigation";
import { CupSoda } from "lucide-react";
import { getArchivedRawMaterials, getPackagingSets, getProfile, getRawMaterials } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PackagingSetsManager } from "@/components/inventory/packaging-sets-manager";
import { sortSetItemsByName } from "@/lib/stock/packaging-input";

// "ชุดภาชนะ" (round D2a, Task 8): owner/manager create, edit and archive the shop's packaging sets.
// Costs are shown here (owner/manager only: materials come through getRawMaterials, behind canViewCosts).
export default async function PackagingSetsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const supabase = await createClient();
  const [sets, active, archived, menus] = await Promise.all([
    getPackagingSets(profile.tenant_id),
    getRawMaterials(profile.tenant_id),
    getArchivedRawMaterials(profile.tenant_id),
    supabase
      .from("products")
      .select("name, packaging_set_id")
      .eq("tenant_id", profile.tenant_id)
      .is("archived_at", null)
      .not("packaging_set_id", "is", null)
      .order("name"),
  ]);

  const toPickable = (archivedFlag: boolean) => (m: (typeof active)[number]) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    costPerUnit: Number(m.cost_per_unit),
    archived: archivedFlag,
  });
  // Archived materials are only kept when a set still lists them (shown as ปิดใช้แล้ว, never offered).
  const usedIds = new Set(sets.flatMap((s) => s.items.map((i) => i.materialId)));
  const materials = [
    ...active.map(toPickable(false)),
    ...archived.filter((m) => usedIds.has(m.id)).map(toPickable(true)),
  ];
  // Items by material name, so a set reads the same after every save (the read returns them in id order).
  const nameById = new Map(materials.map((m) => [m.id, m.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-sidebar">
            <CupSoda size={24} />
            ชุดภาชนะ
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            แก้ว ฝา หลอด ที่หักจากสต๊อกทุกแก้ว — เลือกชุดให้แต่ละเมนูที่หน้าแก้ไขเมนู
          </p>
        </div>
        <Link
          href="/inventory"
          className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
        >
          ← วัตถุดิบ
        </Link>
      </div>

      <PackagingSetsManager
        sets={sets.map((s) => ({
          ...s,
          items: sortSetItemsByName(s.items, (id) => nameById.get(id)),
          menus: (menus.data ?? []).filter((m) => m.packaging_set_id === s.id).map((m) => m.name),
        }))}
        materials={materials}
      />
    </div>
  );
}
