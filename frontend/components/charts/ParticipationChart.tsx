import type { TrendPoint } from "@/lib/analytics";

function LineChart({
  title,
  description,
  points,
  formatValue,
}: {
  title: string;
  description: string;
  points: TrendPoint[];
  formatValue: (value: number) => string;
}) {
  const width = 620;
  const height = 220;
  const left = 42;
  const right = 12;
  const top = 14;
  const bottom = 40;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (index: number) => left + (points.length <= 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1));
  const y = (value: number) => top + chartHeight - Math.max(0, Math.min(100, value)) / 100 * chartHeight;
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-200">{title}</h3>
      <p className="mb-3 text-xs text-slate-500">{description}</p>
      {points.length === 0 ? (
        <p className="flex h-48 items-center justify-center text-sm text-slate-500">Not enough voting data yet</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}: ${points.map(point => `${point.label} ${formatValue(point.value)}`).join(", ")}`}
          className="h-auto w-full overflow-visible"
        >
          {[0, 25, 50, 75, 100].map(tick => (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#1e2d40" strokeDasharray="3 4" />
              <text x={left - 8} y={y(tick) + 4} textAnchor="end" fill="#64748b" fontSize="10">{tick}%</text>
            </g>
          ))}
          <polyline points={coordinates} fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={x(index)} cy={y(point.value)} r="4" fill="#080c10" stroke="#60a5fa" strokeWidth="2" />
              <text x={x(index)} y={height - 12} textAnchor="middle" fill="#94a3b8" fontSize="10">
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function ParticipationChart({
  participation,
  quorum,
}: {
  participation: TrendPoint[];
  quorum: TrendPoint[];
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <LineChart
        title="Participation by proposal"
        description="Share of snapshot supply that voted across the 10 most recent proposals."
        points={participation}
        formatValue={value => `${value.toFixed(1)}%`}
      />
      <LineChart
        title="Quorum achievement over time"
        description="Monthly share of proposals with recorded votes that reached quorum."
        points={quorum}
        formatValue={value => `${value.toFixed(1)}%`}
      />
    </div>
  );
}
