"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Proposal } from "@/lib/types";
import QuorumProgress from "@/components/QuorumProgress";
import VoteBar from "@/components/VoteBar";
import VoterList from "@/components/VoterList";
import { formatNumber, t } from "@/lib/i18n";
import { useLiveProposal } from "@/lib/useLiveProposal";

function percentage(part: number, total: number): string {
  return formatNumber(total > 0 ? (part / total) * 100 : 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Vote results and the voter list for a proposal, refreshed while the page is
 * visible (issue #41). `children` renders between the two sections, which is
 * where the detail page puts its vote buttons.
 */
export default function LiveVoteResults({ initial, children }: { initial: Proposal; children?: ReactNode }) {
  const { proposal, lastUpdated } = useLiveProposal(initial);
  const [now, setNow] = useState(() => Date.now());

  // Ticks the "updated Xs ago" label once a second. Right after a refresh
  // `now` can trail `lastUpdated` until the next tick; that reads as "just now".
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  const seconds = Math.max(0, Math.floor((now - lastUpdated) / 1_000));
  const total = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;

  return (
    <>
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">{t("proposals.results")}</h2>
          <span className="text-xs text-slate-500" aria-live="polite">
            {seconds === 0 ? t("proposals.updatedJustNow") : t("proposals.updatedAgo", { seconds })}
          </span>
        </div>
        <VoteBar forVotes={proposal.forVotes} againstVotes={proposal.againstVotes} abstainVotes={proposal.abstainVotes} />
        <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
          <div><div className="text-emerald-400 font-bold">{(proposal.forVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">{t("common.for")} ({percentage(proposal.forVotes, total)}%)</div></div>
          <div><div className="text-red-400 font-bold">{(proposal.againstVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">{t("common.against")} ({percentage(proposal.againstVotes, total)}%)</div></div>
          <div><div className="text-slate-400 font-bold">{(proposal.abstainVotes / 1000).toFixed(0)}K</div><div className="text-slate-500">{t("common.abstain")} ({percentage(proposal.abstainVotes, total)}%)</div></div>
        </div>
        <QuorumProgress
          forVotes={proposal.forVotes}
          againstVotes={proposal.againstVotes}
          abstainVotes={proposal.abstainVotes}
          quorumRequired={proposal.quorumRequired}
        />
      </div>

      {children}

      {proposal.votes.length > 0 && (
        <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]">
          <h2 className="font-semibold text-white mb-3">{t("proposals.recentVotes")}</h2>
          <VoterList votes={proposal.votes} />
        </div>
      )}
    </>
  );
}
