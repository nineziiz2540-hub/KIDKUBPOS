"use client"

import { useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function DateRangePicker({
  active,
  label,
  onApply,
}: {
  active: boolean
  label: string
  onApply: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        className={cn(
          "px-3 py-1.5 text-sm rounded-md font-medium transition-colors",
          active
            ? "bg-white text-sidebar shadow-sm"
            : "text-muted-foreground hover:text-sidebar"
        )}
      >
        {label}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={8} align="start">
          <PopoverPrimitive.Popup className="w-64 rounded-lg bg-white p-4 shadow-lg outline-none space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                จากวันที่
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                ถึงวันที่
              </label>
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!from || !to}
              className="w-full bg-accent hover:bg-accent/90 text-white"
              onClick={() => {
                onApply(from, to)
                setOpen(false)
              }}
            >
              ใช้ช่วงเวลานี้
            </Button>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { DateRangePicker }
