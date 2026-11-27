import type { MonthlyProposalStats } from "@/lib/analytics";
import { formatNumber } from "@/lib/i18n";

const SERIES = [
  { key: "passed", label: "Passed", color: "#34d399" },
  { key: "failed", label: "Failed", color: "#f87171" },
  { key: "active", label: "Active", color: "#60a5fa" },
  { key: "other", label: "Other", color: "#64748b" },
] as const;

function MonthlyBars({ data }: { data: MonthlyProposalStats[] }) {
  const width = 620;
  const height = 250;
  const left = 30;
  const right = 12;
  const top = 12;
  const bottom = 38;
  const chartHeight = height - top - bottom;
  const maxCount = Math.max(1, ...data.map(month => month.passed + month.failed + month.active + month.other));
  const step = data.length ? (width - left - right) / data.length : 0;
  const barWidth = Math.min(30, step * 0.62);

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-200">Proposals per month</h3>
      <p className="mb-3 text-xs text-slate-500">Grouped by proposal start date and outcome.</p>
      {data.length === 0 ? (
        <p className="flex h-48 items-center justify-center text-sm text-slate-500">No proposals available</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Monthly proposal counts: ${data.map(month => `${month.label}: ${month.passed + month.failed + month.active + month.other}`).join(", ")}`}
          className="h-auto w-full"
        >
          {[0, 0.5, 1].map(fraction => {
            const count = Math.round(maxCount * fraction);
            const y = top + chartHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="#1e2d40" strokeDasharray="3 4" />
                <text x={left - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">{count}</text>
              </g>
            );
          })}
          {data.map((month, index) => {
            let stackedHeight = 0;
            const x = left + index * step + (step - barWidth) / 2;
            return (
              <g key={month.label}>
                {SERIES.map(series => {
                  const count = month[series.key];
                  const barHeight = count / maxCount * chartHeight;
                  const y = top + chartHeight - stackedHeight - barHeight;
                  stackedHeight += barHeight;
                  return count > 0 ? (
                    <rect key={series.key} x={x} y={y} width={barWidth} height={barHeight} fill={series.color} />
                  ) : null;
                })}
                <text x={x + barWidth / 2} y={height - 12} textAnchor="middle" fill="#94a3b8" fontSize="10">
                  {month.label.slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
        {SERIES.map(series => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function VoteDonut({ split }: { split: { for: number; against: number; abstain: number } }) {
  const values = [
    { label: "For", value: split.for, color: "#34d399" },
    { label: "Against", value: split.against, color: "#f87171" },
    { label: "Abstain", value: split.abstain, color: "#94a3b8" },
  ];
  const total = values.reduce((sum, part) => sum + part.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-200">Overall vote-power split</h3>
      <p className="mb-3 text-xs text-slate-500">Share of recorded voting power by choice.</p>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
        <svg
          viewBox="0 0 132 132"
          role="img"
          aria-label={`Vote-power split: ${values.map(part => `${part.label} ${total ? (part.value / total * 100).toFixed(1) : 0}%`).join(", ")}`}
          className="w-36 shrink-0"
        >
          <circle cx="66" cy="66" r={radius} fill="none" stroke="#1e2d40" strokeWidth="18" />
          {total > 0 && values.map(part => {
            const length = part.value / total * circumference;
            const circle = (
              <circle
                key={part.label}
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                stroke={part.color}
                strokeWidth="18"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 66 66)"
              />
            );
            offset += length;
            return circle;
          })}
          <text x="66" y="63" textAnchor="middle" fill="#f1f5f9" fontSize="13" fontWeight="600">
            {total ? formatNumber(total, { notation: "compact", maximumFractionDigits: 1 }) : "—"}
          </text>
          <text x="66" y="79" textAnchor="middle" fill="#64748b" fontSize="9">votes</text>
        </svg>
        <ul className="space-y-2 text-sm">
          {values.map(part => (
            <li key={part.label} className="flex min-w-32 items-center justify-between gap-5">
              <span className="flex items-center gap-2 text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: part.color }} />
                {part.label}
              </span>
              <span className="font-medium text-slate-200">
                {total ? `${(part.value / total * 100).toFixed(1)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ProposalOutcomesChart({
  monthly,
  voteSplit,
}: {
  monthly: MonthlyProposalStats[];
  voteSplit: { for: number; against: number; abstain: number };
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <MonthlyBars data={monthly} />
      <VoteDonut split={voteSplit} />
    </div>
  );
}
