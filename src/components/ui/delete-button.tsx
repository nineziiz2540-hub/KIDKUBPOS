"use client";
import { Button } from "@/components/ui/button";

export function DeleteButton({ message = "ยืนยันการลบ?" }: { message?: string }) {
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      ลบ
    </Button>
  );
}
