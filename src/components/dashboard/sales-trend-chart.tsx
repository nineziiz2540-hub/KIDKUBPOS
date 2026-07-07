"use client";

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { SalesByDay, SalesByMonth } from "@/lib/dal";

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

type Props =
  | { range: "day"; data: { hour: number; total: number }[] }
  | { range: "week" | "month"; data: SalesByDay[] }
  | { range: "year"; data: SalesByMonth[] };

function formatDayLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${Number(parts[2] ?? "0")}/${Number(parts[1] ?? "0")}`;
}

const yFormatter = (v: number) =>
  v >= 1000 ? `฿${(v / 1000).toFixed(0)}k` : `฿${v.toFixed(0)}`;

const tooltipFormatter = (v: unknown) =>
  [`฿${Number(v ?? 0).toFixed(2)}`, "ยอดขาย"] as [string, string];

export function SalesTrendChart(props: Props) {
  if (props.range === "day") {
    const chartData = props.data.map((d) => ({
      label: `${d.hour}:00`,
      total: d.total,
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-sidebar)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (props.range === "week" || props.range === "month") {
    const chartData = props.data.map((d) => ({
      label: formatDayLabel(d.date),
      total: d.total,
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={props.range === "month" ? 4 : 0}
          />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          <Bar dataKey="total" fill="var(--color-sidebar)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // year
  if (props.range === "year") {
    const chartData = props.data.map((d) => ({
      label: THAI_MONTHS[d.month - 1] ?? String(d.month),
      total: d.total,
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          <Bar dataKey="total" fill="var(--color-sidebar)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
