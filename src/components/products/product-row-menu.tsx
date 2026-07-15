"use client";

import { useRef } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
} from "@/components/ui/menu";
import { deleteProduct } from "@/app/actions/products";

export function ProductRowMenu({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <Menu>
        <MenuTrigger className="rounded p-1.5 text-muted-foreground hover:bg-muted/20">
          <MoreVertical size={16} />
        </MenuTrigger>
        <MenuPopup>
          <MenuLinkItem href={`/products/${productId}/edit`}>
            <Pencil size={14} /> แก้ไข
          </MenuLinkItem>
          <MenuSeparator />
          <MenuItem
            destructive
            onClick={() => {
              if (confirm(`ลบสินค้า "${productName}"?`)) {
                formRef.current?.requestSubmit();
              }
            }}
          >
            <Trash2 size={14} /> ลบ
          </MenuItem>
        </MenuPopup>
      </Menu>
      <form ref={formRef} action={deleteProduct} className="hidden">
        <input type="hidden" name="id" value={productId} />
      </form>
    </>
  );
}
