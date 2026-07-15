import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getProfile, getRawMaterials } from "@/lib/dal";
import {
  createRawMaterial,
  updateRawMaterial,
  receiveStock,
  adjustStock,
} from "@/app/actions/inventory";
import { RawMaterialForm } from "@/components/inventory/raw-material-form";
import { StockActionForm } from "@/components/inventory/stock-action-form";
import { MaterialRow } from "@/components/inventory/material-row";
import { Badge } from "@/components/ui/badge";
import { SearchFilter } from "@/components/ui/search-filter";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; id?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { action, id } = await searchParams;
  const materials = await getRawMaterials(profile.tenant_id);

  const editTarget =
    action === "edit" && id
      ? (materials.find((m) => m.id === id) ?? null)
      : null;
  const stockTarget =
    (action === "receive" || action === "adjust") && id
      ? (materials.find((m) => m.id === id) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar flex items-center gap-2">
            <FlaskConical size={24} />
            วัตถุดิบ
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            จัดการวัตถุดิบและสต็อก
          </p>
        </div>
        {action !== "new" && (
          <Link
            href="/inventory?action=new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มวัตถุดิบ
          </Link>
        )}
      </div>

      {/* Create form */}
      {action === "new" && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">เพิ่มวัตถุดิบใหม่</h2>
          <RawMaterialForm action={createRawMaterial} />
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">
            แก้ไข: {editTarget.name}
          </h2>
          <RawMaterialForm action={updateRawMaterial} defaults={editTarget} />
        </div>
      )}

      {/* Stock action form */}
      {stockTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">
            {action === "receive" ? "รับสินค้าเข้าสต็อก" : "ปรับสต็อก"}: {stockTarget.name}
          </h2>
          <StockActionForm
            action={action === "receive" ? receiveStock : adjustStock}
            rawMaterialId={stockTarget.id}
            type={action as "receive" | "adjust"}
            materialName={stockTarget.name}
            currentStock={Number(stockTarget.current_stock)}
            unit={stockTarget.unit}
          />
        </div>
      )}

      {/* Materials table */}
      {materials.length === 0 ? (
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="p-8 text-center text-muted-foreground">
            ยังไม่มีวัตถุดิบ — กด &quot;เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น
          </div>
        </div>
      ) : (
        <SearchFilter placeholder="ค้นหาวัตถุดิบ..." emptyMessage="ไม่พบวัตถุดิบที่ค้นหา">
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-sidebar">ชื่อ</th>
                  <th className="text-left px-4 py-3 font-medium text-sidebar">หน่วย</th>
                  <th className="text-right px-4 py-3 font-medium text-sidebar">ต้นทุน/หน่วย</th>
                  <th className="text-right px-4 py-3 font-medium text-sidebar">สต็อก</th>
                  <th className="text-right px-4 py-3 font-medium text-sidebar">แจ้งเตือน ≤</th>
                  <th className="text-right px-4 py-3 font-medium text-sidebar">การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const isLow =
                    Number(m.min_stock_alert) > 0 &&
                    Number(m.current_stock) <= Number(m.min_stock_alert);
                  return (
                    <MaterialRow
                      key={m.id}
                      id={m.id}
                      name={m.name}
                      unit={m.unit}
                      costPerUnit={Number(m.cost_per_unit)}
                      currentStock={Number(m.current_stock)}
                      minStockAlert={Number(m.min_stock_alert)}
                      isLow={isLow}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </SearchFilter>
      )}
    </div>
  );
}
