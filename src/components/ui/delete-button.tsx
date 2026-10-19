"use client";
import { Button } from "@/components/ui/button";

export function DeleteButton({
  message = "ยืนยันการลบ?",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      ลบ
    </Button>
  );
}
