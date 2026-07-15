"use client";

import { useRef } from "react";
import {
  MoreVertical,
  PackagePlus,
  SlidersHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Badge } from "@/components/ui/badge";
import { deleteRawMaterial } from "@/app/actions/inventory";

export function MaterialRow({
  id,
  name,
  unit,
  costPerUnit,
  currentStock,
  minStockAlert,
  isLow,
}: {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  currentStock: number;
  minStockAlert: number;
  isLow: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleDelete() {
    if (confirm(`ลบ "${name}"?`)) {
      formRef.current?.requestSubmit();
    }
  }

  const menuItems = (
    <>
      <MenuLinkItem href={`/inventory?action=receive&id=${id}`}>
        <PackagePlus size={14} /> รับสินค้า
      </MenuLinkItem>
      <MenuLinkItem href={`/inventory?action=adjust&id=${id}`}>
        <SlidersHorizontal size={14} /> ปรับ
      </MenuLinkItem>
      <MenuLinkItem href={`/inventory?action=edit&id=${id}`}>
        <Pencil size={14} /> แก้ไข
      </MenuLinkItem>
      <MenuSeparator />
      <MenuItem destructive onClick={handleDelete}>
        <Trash2 size={14} /> ลบ
      </MenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <tr
            data-search-value={name}
            className="border-b last:border-0 hover:bg-muted/10"
          />
        }
      >
        <td className="px-4 py-3 font-medium">
          {name}
          {isLow && (
            <Badge variant="destructive" className="ml-2 text-xs">
              สต็อกต่ำ
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">{unit}</td>
        <td className="px-4 py-3 text-right">{costPerUnit.toFixed(4)}</td>
        <td className="px-4 py-3 text-right font-semibold">
          {currentStock.toFixed(3)}
        </td>
        <td className="px-4 py-3 text-right text-muted-foreground">
          {minStockAlert.toFixed(3)}
        </td>
        <td className="px-4 py-3 text-right">
          <Menu>
            <MenuTrigger
              aria-label={`ตัวเลือกสำหรับ ${name}`}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted/20"
            >
              <MoreVertical size={16} />
            </MenuTrigger>
            <MenuPopup>{menuItems}</MenuPopup>
          </Menu>
        </td>
      </ContextMenuTrigger>
      <MenuPopup>{menuItems}</MenuPopup>
      <form ref={formRef} action={deleteRawMaterial} className="hidden">
        <input type="hidden" name="id" value={id} />
      </form>
    </ContextMenu>
  );
}
