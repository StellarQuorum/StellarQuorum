'use client';

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, User } from "lucide-react";
import { getProposalById } from "@/lib/proposals";
import StatusBadge from "@/components/StatusBadge";
import VoteBar from "@/components/VoteBar";

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const proposal = getProposalById(id);

  if (!proposal) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Proposal not found</h1>
        <Link href="/proposals" className="text-blue-400 hover:text-blue-300">← Back to proposals</Link>
      </div>
    );
  }

  const total = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
  const forPct = total > 0 ? ((proposal.forVotes / total) * 100).toFixed(1) : "0.0";
  const againstPct = total > 0 ? ((proposal.againstVotes / total) * 100).toFixed(1) : "0.0";
  const abstainPct = total > 0 ? ((proposal.abstainVotes / total) * 100).toFixed(1) : "0.0";
  const quorumReached = total >= proposal.quorumRequired;

  const choiceColors: Record<string, string> = {
    for: "text-emerald-400",
    against: "text-red-400",
    abstain: "text-slate-400",
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/proposals" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-300 mb-8 transition-colors">
        <ArrowLeft size={14} /> Back to proposals
      </Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <StatusBadge status={proposal.status} />
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#162032] text-slate-400 border border-[#1e2d40]">{proposal.category}</span>
          <span className="text-xs text-slate-500 font-mono ml-auto">{proposal.id}</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-4">{proposal.title}</h1>
        <div className="flex items-center gap-6 text-sm text-slate-500">
          <span className="flex items-center gap-1.5"><User size={13} /> {proposal.proposer}</span>
          <span className="flex items-center gap-1.5"><Clock size={13} /> Voting {new Date(proposal.startTime).toLocaleDateString()} – {new Date(proposal.endTime).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Description */}
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] mb-6">
        <h2 className="font-semibold text-white mb-3">Description</h2>
        <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{proposal.description}</div>
      </div>

      {/* Actions */}
      {proposal.actions.length > 0 && (
        <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] mb-6">
          <h2 className="font-semibold text-white mb-3">On-chain Actions</h2>
          <div className="flex flex-col gap-3">
            {proposal.actions.map((action, i) => (
              <div key={i} className="p-3 rounded-lg bg-[#080c10] border border-[#1a2535] text-sm">
                <div className="text-slate-200 font-medium mb-1">{action.description}</div>
                <div className="font-mono text-xs text-slate-500">{action.contractAddress} → {action.functionName}()</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vote Results */}
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] mb-6">
        <h2 className="font-semibold text-white mb-4">Voting Results</h2>
        <VoteBar forVotes={proposal.forVotes} againstVotes={proposal.againstVotes} abstainVotes={proposal.abstainVotes} />
        <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
          <div><div className="text-emerald-400 font-bold">{(proposal.forVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">For ({forPct}%)</div></div>
          <div><div className="text-red-400 font-bold">{(proposal.againstVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">Against ({againstPct}%)</div></div>
          <div><div className="text-slate-400 font-bold">{(proposal.abstainVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">Abstain ({abstainPct}%)</div></div>
        </div>
        <div className="mt-4 pt-4 border-t border-[#1a2535]">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Quorum</span>
            <span className={quorumReached ? "text-emerald-400" : "text-amber-400"}>
              {(total / 1000).toFixed(0)}K / {(proposal.quorumRequired / 1000).toFixed(0)}K required
            </span>
          </div>
          <div className="h-2 bg-[#1a2535] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quorumReached ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min((total / proposal.quorumRequired) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Vote CTA */}
      {proposal.status === "active" && (
        <div className="p-5 rounded-xl bg-[#0d1520] border border-blue-800/40 mb-6">
          <h2 className="font-semibold text-white mb-3">Cast Your Vote</h2>
          <div className="flex gap-3 mb-3">
            <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">Vote For</button>
            <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} className="flex-1 py-2.5 rounded-lg bg-red-800 hover:bg-red-700 text-white font-semibold text-sm transition-colors">Vote Against</button>
            <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} className="flex-1 py-2.5 rounded-lg bg-[#162032] hover:bg-[#1a2a40] text-slate-300 font-semibold text-sm border border-[#1a2535] transition-colors">Abstain</button>
          </div>
          <p className="text-xs text-slate-500">Connect your Freighter wallet to vote — testnet integration in progress.</p>
        </div>
      )}

      {/* Recent Votes */}
      {proposal.votes.length > 0 && (
        <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]">
          <h2 className="font-semibold text-white mb-3">Recent Votes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[#1a2535]">
                  <th className="pb-2 pr-4">Voter</th>
                  <th className="pb-2 pr-4">Choice</th>
                  <th className="pb-2 pr-4">Weight</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {proposal.votes.map((vote, i) => (
                  <tr key={i} className="border-b border-[#0f1a28] last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-400">{vote.voter}</td>
                    <td className={`py-2 pr-4 font-semibold capitalize ${choiceColors[vote.choice]}`}>{vote.choice}</td>
                    <td className="py-2 pr-4 text-slate-400">{(vote.weight / 1000).toFixed(0)}K</td>
                    <td className="py-2 text-slate-500 text-xs">{new Date(vote.timestamp).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
