"use client";
import { useEffect, useRef } from "react";
import { useToastManager } from "@/components/ui/toast";

export function SavedToastTrigger({ title = "บันทึกสำเร็จ" }: { title?: string }) {
  const toastManager = useToastManager();
  const toastManagerRef = useRef(toastManager);
  useEffect(() => {
    toastManagerRef.current = toastManager;
  });

  const titleRef = useRef(title);
  useEffect(() => {
    toastManagerRef.current.add({ title: titleRef.current, type: "success" });
  }, []);

  return null;
}
