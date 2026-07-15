"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider

function Toaster() {
  const { toasts } = ToastPrimitive.useToastManager()
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
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
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

export { ToastProvider, Toaster }
export const useToastManager = ToastPrimitive.useToastManager
