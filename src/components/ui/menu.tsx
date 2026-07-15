"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuPopup({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={4} align="end">
        <MenuPrimitive.Popup
          className={cn(
            "min-w-[168px] rounded-lg bg-white p-1 shadow-lg outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({
  className,
  destructive,
  ...props
}: MenuPrimitive.Item.Props & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium outline-none cursor-pointer data-[highlighted]:bg-muted/50",
        destructive ? "text-destructive" : "text-sidebar",
        className
      )}
      {...props}
    />
  )
}

function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props) {
  return (
    <MenuPrimitive.LinkItem
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar outline-none cursor-pointer data-[highlighted]:bg-muted/50",
        className
      )}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("my-1 h-px bg-[#E5E5E5]", className)}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator }
