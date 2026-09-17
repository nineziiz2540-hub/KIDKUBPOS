import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Shows whether `current` moved up/down/flat vs `previous`.
 *
 * The wording is always directionally true ("increased"/"decreased" from
 * yesterday) regardless of whether that direction is good or bad — only the
 * COLOR depends on `higherIsBetter`. This keeps the badge honest for metrics
 * like cost, where a higher value is worse (red) but the text must still say
 * "increased", not "worse".
 */
export function TrendBadge({
  current,
  previous,
  higherIsBetter,
}: {
  current: number;
  previous: number;
  higherIsBetter: boolean;
}) {
  if (current > previous) {
    const colorClass = higherIsBetter ? "text-success" : "text-destructive";
    return (
      <span className={`flex items-center gap-0.5 text-xs font-medium ${colorClass}`}>
        <TrendingUp size={12} />
        เพิ่มขึ้นจากเมื่อวาน
      </span>
    );
  }
  if (current < previous) {
    const colorClass = higherIsBetter ? "text-destructive" : "text-success";
    return (
      <span className={`flex items-center gap-0.5 text-xs font-medium ${colorClass}`}>
        <TrendingDown size={12} />
        ลดลงจากเมื่อวาน
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus size={12} />
      เท่าเมื่อวาน
    </span>
  );
}
