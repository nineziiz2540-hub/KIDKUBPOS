"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = [
  "var(--color-sidebar)",
  "var(--color-accent)",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#a78bfa",
];

export function CategoryPerformanceChart({
  data,
}: {
  data: { category: string; total: number }[];
}) {
  const filtered = data.filter((d) => d.total > 0);

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        ยังไม่มีข้อมูลการขายในช่วงนี้
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="total"
          nameKey="category"
          cx="50%"
          cy="50%"
          outerRadius={80}
          innerRadius={40}
          paddingAngle={2}
        >
          {filtered.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length] ?? "#6b7280"} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: unknown) =>
            [`฿${Number(v ?? 0).toFixed(2)}`, "ยอดขาย"] as [string, string]
          }
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs text-sidebar">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
