"use client";

import Link from "next/link";
import { MoreVertical, PackagePlus, SlidersHorizontal, Pencil, Archive, History } from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
} from "@/components/ui/menu";
import { useToastManager } from "@/components/ui/toast";
import { deleteRawMaterial, unarchiveRawMaterial } from "@/app/actions/inventory";
import { materialStatus, approxPurchaseText, formatQty } from "@/lib/stock/material-view";

const STATUS_STYLE = {
  ok: "bg-success/10 text-success",
  low: "bg-warning/10 text-warning",
  negative: "bg-destructive/10 text-destructive",
} as const;

export function MaterialRow({
  id,
  name,
  unit,
  costPerUnit,
  currentStock,
  minStockAlert,
  purchaseUnit,
  purchaseSize,
  trackStock,
}: {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  currentStock: number;
  minStockAlert: number;
  purchaseUnit: string | null;
  purchaseSize: number | null;
  trackStock: boolean;
}) {
  const toast = useToastManager();
  const status = materialStatus(currentStock, minStockAlert);
  const approx = approxPurchaseText(currentStock, purchaseSize, purchaseUnit);

  async function archive() {
    const fd = new FormData();
    fd.set("id", id);
    const result = await deleteRawMaterial(fd);
    if (result?.error) {
      toast.add({ title: result.error, type: "error" });
      return;
    }
    let done = false;
    const toastId = toast.add({
      title: `ปิดใช้: ${name}`,
      type: "success",
      timeout: 5000,
      actionProps: {
        children: "ย้อนกลับ",
        onClick: async () => {
          if (done) return;
          done = true;
          toast.close(toastId);
          const undoFd = new FormData();
          undoFd.set("id", id);
          const undo = await unarchiveRawMaterial(undoFd);
          toast.add(
            undo?.error
              ? { title: undo.error, type: "error" }
              : { title: `เปิดใช้อีกครั้ง: ${name}`, type: "success" }
          );
        },
      },
    });
  }

  return (
    <tr data-search-value={name} className="border-b last:border-0">
      <td className="px-4 py-3 font-medium">{name}</td>
      <td className="px-4 py-3 text-right">
        {trackStock ? (
          <>
            <span className="font-semibold">{formatQty(currentStock, unit).replace("+", "")}</span>
            {approx && <span className="block text-xs text-muted-foreground">{approx}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">ไม่ติดตามสต๊อก</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {costPerUnit.toLocaleString("en-US", { maximumFractionDigits: 4 })}
      </td>
      <td className="px-4 py-3">
        {trackStock ? (
          <span
            className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium ${STATUS_STYLE[status.kind]}`}
          >
            {status.label}
          </span>
        ) : (
          <span className="inline-flex min-h-8 items-center rounded-full bg-muted/30 px-3 text-sm font-medium text-muted-foreground">
            ไม่ติดตาม
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          {trackStock && (
            <Link
              href={`/inventory?action=receive&id=${id}`}
              className="inline-flex h-14 items-center gap-2 rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent/90"
            >
              <PackagePlus size={18} /> รับของเข้า
            </Link>
          )}
          <Menu>
            <MenuTrigger
              aria-label={`ตัวเลือกสำหรับ ${name}`}
              className="flex size-14 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted/20"
            >
              <MoreVertical size={20} />
            </MenuTrigger>
            <MenuPopup>
              {trackStock && (
                <MenuLinkItem href={`/inventory?action=adjust&id=${id}`} className="min-h-12">
                  <SlidersHorizontal size={16} /> ปรับยอด
                </MenuLinkItem>
              )}
              <MenuLinkItem href={`/inventory?action=history&id=${id}`} className="min-h-12">
                <History size={16} /> ประวัติสต๊อก
              </MenuLinkItem>
              <MenuLinkItem href={`/inventory?action=edit&id=${id}`} className="min-h-12">
                <Pencil size={16} /> แก้ไข
              </MenuLinkItem>
              <MenuSeparator />
              <MenuItem destructive onClick={archive} className="min-h-12">
                <Archive size={16} /> ปิดใช้
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </td>
    </tr>
  );
}
