"use client";
import { Button } from "@/components/ui/button";
import { seedStockGroups } from "@/app/actions/stock-config";
import { useConfigAction } from "./use-config-action";

/** First-time setup: creates only the groups/levels that are missing, so a second press changes nothing. */
export function SeedGroupsCard({ firstTime }: { firstTime: boolean }) {
  const { run, busy } = useConfigAction();
  return (
    <div className="space-y-3 rounded-lg border bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-sidebar">
          {firstTime ? "ยังไม่ได้ตั้งค่า" : "ยังมีกลุ่มตั้งต้นที่ไม่ครบ"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          กดปุ่มด้านล่างเพื่อสร้างกลุ่ม เมล็ด / มัทฉะ / ความหวาน และระดับ ไม่หวาน / หวานน้อย / หวานปกติ / หวานมาก
          — กดซ้ำได้ ระบบสร้างเฉพาะที่ยังไม่มี
        </p>
      </div>
      <Button
        type="button"
        disabled={busy !== null}
        onClick={() => run("seed", () => seedStockGroups(), "สร้างกลุ่มตั้งต้นแล้ว")}
        className="h-14 bg-accent px-6 text-base font-semibold text-white hover:bg-accent/90"
      >
        {busy === "seed" ? "กำลังสร้าง…" : "สร้างกลุ่มตั้งต้น"}
      </Button>
    </div>
  );
}
