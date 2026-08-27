"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const CATEGORY_PALETTE = [
  "#8b5e3c", // coffee brown
  "#22c55e", // green (matcha)
  "#f97316", // orange (Thai tea / non-coffee)
  "#eab308", // yellow (bakery / croissant)
  "#60a5fa", // blue
  "#f472b6", // pink
  "#a78bfa", // purple
  "#14b8a6", // teal
];
const UNCATEGORIZED_COLOR = "#4b5563"; // reserved dark gray, not part of the rotation
const UNCATEGORIZED_LABEL = "ไม่มีหมวดหมู่";

function colorForCategory(name: string): string {
  if (name === UNCATEGORIZED_LABEL) return UNCATEGORIZED_COLOR;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]!;
}

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
          {filtered.map((d) => (
            <Cell key={d.category} fill={colorForCategory(d.category)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: unknown, _name: unknown, entry: { payload?: { category?: string; total?: number } }) => {
            const total = Number(v ?? 0);
            const grandTotal = filtered.reduce((sum, d) => sum + d.total, 0);
            const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : "0.0";
            return [`฿${total.toFixed(2)} (${pct}%)`, entry.payload?.category ?? "ยอดขาย"] as [
              string,
              string
            ];
          }}
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
