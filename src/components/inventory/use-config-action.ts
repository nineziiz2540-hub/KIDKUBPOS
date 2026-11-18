"use client";
import { useState } from "react";
import { useToastManager } from "@/components/ui/toast";
import type { StockConfigState } from "@/app/actions/stock-config";

/** Runs one setup action, shows its result as a toast (errors always, success only when given words). */
export function useConfigAction() {
  const toast = useToastManager();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<StockConfigState>, okTitle?: string): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    let result: StockConfigState;
    try {
      result = await fn();
    } catch {
      result = { error: "บันทึกไม่สำเร็จ — ลองอีกครั้ง" };
    }
    setBusy(null);
    if (result?.error) {
      toast.add({ title: result.error, type: "error" });
      return false;
    }
    if (okTitle) toast.add({ title: okTitle, type: "success" });
    return true;
  }

  return { run, busy, toast };
}
