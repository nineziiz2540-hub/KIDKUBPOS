"use client";
import { useEffect, useRef } from "react";
import { useToastManager } from "@/components/ui/toast";

export function SavedToastTrigger() {
  const toastManager = useToastManager();
  const toastManagerRef = useRef(toastManager);
  toastManagerRef.current = toastManager;

  useEffect(() => {
    toastManagerRef.current.add({ title: "บันทึกสำเร็จ", type: "success" });
  }, []);

  return null;
}
