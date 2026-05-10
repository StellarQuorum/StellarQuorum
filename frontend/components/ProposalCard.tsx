import Link from "next/link";
import type { Proposal } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import VoteBar from "./VoteBar";

function daysRelative(iso: string, future: boolean): string {
  const diff = Math.abs(new Date(iso).getTime() - Date.now());
  const days = Math.round(diff / 86400000);
  if (days === 0) return future ? "Ends today" : "Ended today";
  return future ? `Ends in ${days}d` : `Ended ${days}d ago`;
}

export default function ProposalCard({ proposal }: { proposal: Proposal }) {
  const isActive = proposal.status === "active" || proposal.status === "pending";
  const total = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;

  return (
    <Link href={`/proposals/${proposal.id}`}>
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] hover:border-blue-700/70 hover:shadow-lg hover:shadow-blue-900/20 transition-all group cursor-pointer">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={proposal.status} />
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#162032] text-slate-400 border border-[#1e2d40]">
              {proposal.category}
            </span>
          </div>
          <span className="text-xs text-slate-500 shrink-0">{proposal.id}</span>
        </div>

        <h3 className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors mb-2 leading-snug">
          {proposal.title}
        </h3>

        <p className="text-xs text-slate-500 mb-4">
          Proposed by <span title={proposal.proposer}>{proposal.proposer}</span> &middot; {daysRelative(proposal.endTime, isActive)}
        </p>

        <VoteBar
          forVotes={proposal.forVotes}
          againstVotes={proposal.againstVotes}
          abstainVotes={proposal.abstainVotes}
          compact
        />

        {total > 0 && (
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="text-emerald-500">{(proposal.forVotes / 1000).toFixed(0)}K For</span>
            <span className="text-red-400">{(proposal.againstVotes / 1000).toFixed(0)}K Against</span>
          </div>
        )}
      </div>
    </Link>
  );
}
