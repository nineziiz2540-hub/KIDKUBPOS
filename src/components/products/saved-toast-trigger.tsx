"use client";
import { useEffect } from "react";
import { useToastManager } from "@/components/ui/toast";

export function SavedToastTrigger() {
  const toastManager = useToastManager();
  useEffect(() => {
    toastManager.add({ title: "บันทึกสำเร็จ", type: "success" });
  }, [toastManager]);
  return null;
}
