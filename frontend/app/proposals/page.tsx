'use client';

import { useState } from "react";
import { PROPOSALS } from "@/lib/proposals";
import ProposalCard from "@/components/ProposalCard";
import type { ProposalStatus } from "@/lib/types";

const FILTERS: { label: string; value: ProposalStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Passed", value: "passed" },
  { label: "Failed", value: "failed" },
  { label: "Pending", value: "pending" },
];

export default function ProposalsPage() {
  const [filter, setFilter] = useState<ProposalStatus | "all">("all");

  const filtered = filter === "all" ? PROPOSALS : PROPOSALS.filter(p => p.status === filter);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">All Proposals</h1>
        <p className="text-slate-400">{PROPOSALS.length} total proposals across all stages</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-8 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-blue-600 text-white"
                : "bg-[#0d1520] border border-[#1a2535] text-slate-400 hover:border-blue-800"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                {PROPOSALS.filter(p => p.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">No proposals match this filter.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(p => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}
