import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import {
  getProfile,
  getRawMaterials,
  getArchivedRawMaterials,
  getMaterialHistory,
  getStockFlags,
  getPausedMenus,
} from "@/lib/dal";
import { StockFlags } from "@/components/inventory/stock-flags";
import { createRawMaterial, updateRawMaterial } from "@/app/actions/inventory";
import { RawMaterialForm } from "@/components/inventory/raw-material-form";
import { StockActionForm } from "@/components/inventory/stock-action-form";
import { MaterialRow } from "@/components/inventory/material-row";
import { MaterialHistory } from "@/components/inventory/material-history";
import { ArchivedMaterialsSection } from "@/components/inventory/archived-materials-section";
import { SearchFilter } from "@/components/ui/search-filter";

const DEFAULT_CATEGORIES = [
  "วัตถุดิบทั่วไป",
  "เมล็ดกาแฟ",
  "มัทฉะ",
  "นม & ครีม",
  "ไซรัป & สารให้ความหวาน",
  "บรรจุภัณฑ์",
  "ของผสมเตรียม",
];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; id?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { action, id } = await searchParams;
  const [materials, archived, flags, pausedMenus] = await Promise.all([
    getRawMaterials(profile.tenant_id),
    getArchivedRawMaterials(profile.tenant_id),
    getStockFlags(profile.tenant_id),
    getPausedMenus(profile.tenant_id),
  ]);

  const editTarget =
    action === "edit" && id ? (materials.find((m) => m.id === id) ?? null) : null;
  const stockTarget =
    (action === "receive" || action === "adjust") && id
      ? (materials.find((m) => m.id === id) ?? null)
      : null;
  const historyTarget =
    action === "history" && id ? (materials.find((m) => m.id === id) ?? null) : null;
  const history = historyTarget
    ? await getMaterialHistory(profile.tenant_id, historyTarget.id)
    : [];

  const categories = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...materials.map((m) => m.category), ...archived.map((m) => m.category)])
  );

  // Group the active list by หมวด: shop categories in the usual order, then any custom ones.
  const grouped = categories
    .map((c) => ({ category: c, items: materials.filter((m) => m.category === c) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-sidebar">
            <FlaskConical size={24} />
            วัตถุดิบ
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">จัดการวัตถุดิบและสต๊อก</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/inventory/groups"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            กลุ่มตัวเลือก
          </Link>
          <Link
            href="/inventory/packaging"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            ชุดภาชนะ
          </Link>
          <Link
            href="/inventory/sweetness"
            className="inline-flex h-14 items-center rounded-lg border bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted"
          >
            ตารางความหวาน
          </Link>
          {action !== "new" && (
            <Link
              href="/inventory?action=new"
              className="inline-flex h-14 items-center gap-1.5 rounded-lg bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
            >
              + เพิ่มวัตถุดิบ
            </Link>
          )}
        </div>
      </div>

      <StockFlags flags={flags} paused={pausedMenus} />

      {action === "new" && (
        <div className="space-y-4 rounded-lg border bg-white p-5">
          <h2 className="text-base font-semibold text-sidebar">เพิ่มวัตถุดิบใหม่</h2>
          <RawMaterialForm action={createRawMaterial} categories={categories} />
        </div>
      )}

      {editTarget && (
        <div className="space-y-4 rounded-lg border bg-white p-5">
          <h2 className="text-base font-semibold text-sidebar">แก้ไข: {editTarget.name}</h2>
          <RawMaterialForm
            key={editTarget.id}
            action={updateRawMaterial}
            defaults={editTarget}
            categories={categories}
          />
        </div>
      )}

      {stockTarget && (
        <div className="space-y-4 rounded-lg border bg-white p-5">
          <h2 className="text-base font-semibold text-sidebar">
            {action === "receive" ? "รับของเข้า" : "ปรับยอด"}: {stockTarget.name}
          </h2>
          <StockActionForm
            key={`${action}-${stockTarget.id}`}
            type={action as "receive" | "adjust"}
            rawMaterialId={stockTarget.id}
            materialName={stockTarget.name}
            currentStock={Number(stockTarget.current_stock)}
            unit={stockTarget.unit}
            purchaseUnit={stockTarget.purchase_unit}
            purchaseSize={stockTarget.purchase_size === null ? null : Number(stockTarget.purchase_size)}
            role={profile.role}
          />
        </div>
      )}

      {historyTarget && (
        <MaterialHistory name={historyTarget.name} unit={historyTarget.unit} rows={history} />
      )}

      {materials.length === 0 ? (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="p-8 text-center text-muted-foreground">
            ยังไม่มีวัตถุดิบ — กด &quot;เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น
          </div>
        </div>
      ) : (
        <SearchFilter placeholder="ค้นหาวัตถุดิบ..." emptyMessage="ไม่พบวัตถุดิบที่ค้นหา">
          <div className="space-y-5">
            {grouped.map((g) => (
              <section key={g.category} className="space-y-2">
                <h2 className="text-base font-semibold text-sidebar">{g.category}</h2>
                <div className="overflow-hidden rounded-lg border bg-white">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-sidebar">ชื่อ</th>
                        <th className="px-4 py-3 text-right font-medium text-sidebar">คงเหลือ</th>
                        <th className="px-4 py-3 text-right font-medium text-sidebar">ต้นทุน/หน่วย</th>
                        <th className="px-4 py-3 text-left font-medium text-sidebar">สถานะ</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((m) => (
                        <MaterialRow
                          key={m.id}
                          id={m.id}
                          name={m.name}
                          unit={m.unit}
                          costPerUnit={Number(m.cost_per_unit)}
                          currentStock={Number(m.current_stock)}
                          minStockAlert={Number(m.min_stock_alert)}
                          purchaseUnit={m.purchase_unit}
                          purchaseSize={m.purchase_size === null ? null : Number(m.purchase_size)}
                          trackStock={m.track_stock}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </SearchFilter>
      )}

      {archived.length > 0 && (
        <ArchivedMaterialsSection
          materials={archived.map((m) => ({ id: m.id, name: m.name, category: m.category }))}
        />
      )}
    </div>
  );
}
