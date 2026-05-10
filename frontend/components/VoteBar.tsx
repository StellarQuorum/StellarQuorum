interface VoteBarProps {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  compact?: boolean;
}

export default function VoteBar({ forVotes, againstVotes, abstainVotes, compact = false }: VoteBarProps) {
  const total = forVotes + againstVotes + abstainVotes;
  const forPct = total > 0 ? (forVotes / total) * 100 : 0;
  const againstPct = total > 0 ? (againstVotes / total) * 100 : 0;
  const abstainPct = total > 0 ? (abstainVotes / total) * 100 : 0;

  if (total === 0) {
    return <div className={`${compact ? "h-1.5" : "h-3"} rounded-full bg-[#1a2535] w-full`} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex ${compact ? "h-1.5" : "h-3"} rounded-full overflow-hidden gap-px`}>
        {forPct > 0 && <div className="bg-emerald-500 rounded-l-full" style={{ width: `${forPct}%` }} />}
        {againstPct > 0 && <div className="bg-red-500" style={{ width: `${againstPct}%` }} />}
        {abstainPct > 0 && <div className="bg-slate-500 rounded-r-full" style={{ width: `${abstainPct}%` }} />}
      </div>
      {!compact && (
        <div className="flex gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />For {forPct.toFixed(1)}%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Against {againstPct.toFixed(1)}%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-500" />Abstain {abstainPct.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
