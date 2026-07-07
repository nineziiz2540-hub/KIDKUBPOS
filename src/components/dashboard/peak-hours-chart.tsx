"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import type { HourlyPattern } from "@/lib/dal";

export function PeakHoursChart({ data }: { data: HourlyPattern[] }) {
  const peakHour = data.reduce<HourlyPattern>(
    (best, d) => (d.total > best.total ? d : best),
    { hour: 0, total: 0 }
  );

  const chartData = data.map((d) => ({
    label: String(d.hour),
    total: d.total,
    isPeak: d.hour === peakHour.hour && d.total > 0,
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sidebar">ช่วงเวลาที่ขายดี</h3>
        {peakHour.total > 0 && (
          <span className="text-xs font-medium text-accent">
            ดีที่สุด: {peakHour.hour}:00–{peakHour.hour + 1}:00
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval={2}
            tickFormatter={(h: string) => `${h}h`}
          />
          <YAxis hide />
          <Tooltip
            formatter={(v: unknown) =>
              [`฿${Number(v ?? 0).toFixed(2)}`, "ยอดขาย"] as [string, string]
            }
            labelFormatter={(l: unknown) => `${String(l ?? "")}:00`}
          />
          <Bar dataKey="total" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.isPeak ? "var(--color-accent)" : "var(--color-sidebar)"}
                opacity={entry.total === 0 ? 0.2 : 0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
