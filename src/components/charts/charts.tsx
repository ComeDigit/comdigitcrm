"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/utils";

/**
 * Chart components (client). Monochrome palette from design tokens;
 * money series arrive as minor units and format through formatMoney so
 * charts and KPI cards can never disagree.
 */

export interface TrendPoint {
  date: string;
  [series: string]: number | string;
}

const axisStyle = { fontSize: 11, fill: "var(--muted)" } as const;

function shortDate(d: string): string {
  const x = new Date(d);
  return x.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function ChartTooltip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{label ? shortDate(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center justify-between gap-4 text-muted">
          <span className="capitalize">{p.name}</span>
          <span className="font-medium text-foreground tabular-nums">
            {money ? formatMoney(p.value) : p.value.toLocaleString("en-IN")}
          </span>
        </p>
      ))}
    </div>
  );
}

export function MoneyAreaChart({
  data,
  series,
  height = 260,
}: {
  data: TrendPoint[];
  series: Array<{ key: string; label: string }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-primary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="date"
          tick={axisStyle}
          tickFormatter={shortDate}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tick={axisStyle}
          tickFormatter={(v: number) => formatMoney(v)}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip content={<ChartTooltip money />} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={i === 0 ? "var(--chart-1)" : "var(--chart-2)"}
            strokeWidth={1.8}
            fill={i === 0 ? "url(#fill-primary)" : "transparent"}
            strokeDasharray={i === 0 ? undefined : "4 4"}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CountBarChart({
  data,
  dataKey,
  label,
  height = 220,
}: {
  data: TrendPoint[];
  dataKey: string;
  label: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={axisStyle}
          tickFormatter={shortDate}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<ChartTooltip />} />
        <Bar
          dataKey={dataKey}
          name={label}
          fill="var(--chart-1)"
          radius={[3, 3, 0, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
