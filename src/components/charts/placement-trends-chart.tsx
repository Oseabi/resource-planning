"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export interface MonthlyPlacements {
  month: string; // e.g. "Feb 2026"
  requirement: number;
  tender: number;
}

export function PlacementTrendsChart({ data }: { data: MonthlyPlacements[] }) {
  if (data.every((d) => d.requirement === 0 && d.tender === 0)) {
    return (
      <p className="py-10 text-center text-body-sm text-muted-foreground">
        No placements yet, trends will appear here as candidates are placed.
      </p>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="requirement" name="Job requirements" stackId="a" fill="var(--chart-1)" maxBarSize={42} />
          <Bar dataKey="tender" name="Tenders" stackId="a" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
