import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import type { Weight, Workout } from "./data";
const formatDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export default function WeightChart({ weights }: { weights: Weight[] }) {
  const weight = weights.at(-1)?.value || 0;
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Body weight over ${weights.length} entries. Latest ${weight} pounds.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={weights}>
          <defs>
            <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a8c72" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#4a8c72" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            minTickGap={50}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
          />
          <YAxis
            domain={["dataMin - 1", "dataMax + 1"]}
            width={35}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(v) => formatDate(String(v))}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name="Weight (lb)"
            stroke="#4a8c72"
            strokeWidth={2.5}
            fill="url(#weightFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function BenchChart({ bench }: { bench: Workout[] }) {
  return (
    <div
      className="chart"
      role="img"
      aria-label="Bench press working set weight over time"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={bench}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            minTickGap={40}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
          />
          <YAxis width={35} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="weight"
            name="Working weight (lb)"
            stroke="#be8757"
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
