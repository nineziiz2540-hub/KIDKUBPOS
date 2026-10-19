"use client";

import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
} from "@/components/ui/menu";
import { RemoveProductDialog } from "@/components/products/remove-product-dialog";

export function ProductRowMenu({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={`ตัวเลือกสำหรับ ${productName}`}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted/20"
        >
          <MoreVertical size={16} />
        </MenuTrigger>
        <MenuPopup>
          <MenuLinkItem href={`/products/${productId}/edit`}>
            <Pencil size={14} /> แก้ไข
          </MenuLinkItem>
          <MenuSeparator />
          <MenuItem destructive onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> ลบ
          </MenuItem>
        </MenuPopup>
      </Menu>
      {confirming && (
        <RemoveProductDialog
          productId={productId}
          productName={productName}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
