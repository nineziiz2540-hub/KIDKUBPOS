import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const stats = [
  { title: "ยอดขายวันนี้", value: "฿0", variant: "default" as const },
  { title: "ออเดอร์", value: "0", variant: "default" as const },
  { title: "สินค้า", value: "0", variant: "secondary" as const },
  { title: "ลูกค้า", value: "0", variant: "secondary" as const },
] satisfies { title: string; value: string; variant: "default" | "secondary" }[];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">ยินดีต้อนรับสู่ KIDKUBPOS</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ title, value, variant }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-sidebar">{value}</span>
                <Badge variant={variant} className="mb-0.5">
                  {variant === "default" ? "live" : "—"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
