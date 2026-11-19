"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider

function Toaster() {
  const { toasts } = ToastPrimitive.useToastManager()
  return (
    <ToastPrimitive.Portal>
      {/* Top layer of the app (above the phone cart drawer z-[60], held-bill modals z-[70] and the
          logout confirm z-[100]) so a "ย้อนกลับ" toast is never hidden behind the screen it came from.
          w-max: a fixed box at left-1/2 would otherwise only get half the screen and wrap word by word. */}
      <ToastPrimitive.Viewport className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] w-max max-w-[calc(100vw-2rem)] flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            toast={toast}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg",
              toast.type === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success"
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-white",
                toast.type === "error" ? "bg-destructive" : "bg-success"
              )}
            >
              {toast.type === "error" ? <X size={12} /> : <Check size={12} />}
            </span>
            <ToastPrimitive.Title className="text-sm font-medium" />
            {/* Renders only when the toast was added with actionProps (e.g. "ย้อนกลับ"). */}
            {toast.actionProps && (
              <ToastPrimitive.Action className="ml-2 min-h-14 rounded-md border border-current px-4 text-base font-semibold" />
            )}
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

export { ToastProvider, Toaster }
export const useToastManager = ToastPrimitive.useToastManager
