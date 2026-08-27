import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PaymentMethodCard({ cash, transfer }: { cash: number; transfer: number }) {
  const total = cash + transfer;
  const cashPct = total > 0 ? ((cash / total) * 100).toFixed(0) : "0";
  const transferPct = total > 0 ? ((transfer / total) * 100).toFixed(0) : "0";

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">เงินสด</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿{cash.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">({cashPct}%)</span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">เงินโอน</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿{transfer.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">({transferPct}%)</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
