'use client';

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import ProposalCard from "@/components/ProposalCard";
import StatusBadge from "@/components/StatusBadge";
import type { Proposal, ProposalStatus } from "@/lib/types";
import { formatNumber, t } from "@/lib/i18n";

type Density = "cards" | "compact";

const FILTERS: { label: string; value: ProposalStatus | "all" }[] = [
  { label: t("proposals.all"), value: "all" },
  { label: t("common.active"), value: "active" },
  { label: t("common.passed"), value: "passed" },
  { label: t("common.failed"), value: "failed" },
  { label: t("common.pending"), value: "pending" },
  { label: t("common.queued"), value: "queued" },
  { label: t("common.vetoed"), value: "vetoed" },
  { label: t("common.expired"), value: "expired" },
  { label: t("common.executed"), value: "executed" },
  { label: t("common.cancelled"), value: "cancelled" },
];

export default function ProposalList({ proposals }: { proposals: Proposal[] }) {
  const [filter, setFilter] = useState<ProposalStatus | "all">("all");
  const [sort, setSort] = useState<"recent" | "votes" | "title">("recent");
  const [density, setDensity] = useState<Density>("cards");
  const activeCount = proposals.filter(p => p.status === 'active').length;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("proposal-density") as Density | null;
      if (saved === "cards" || saved === "compact") setDensity(saved);
    } catch { /* localStorage unavailable */ }
  }, []);

  function toggleDensity(next: Density) {
    setDensity(next);
    try { localStorage.setItem("proposal-density", next); } catch { /* ignore */ }
  }

  const filtered = [...(filter === "all" ? proposals : proposals.filter(p => p.status === filter))].sort((a, b) => {
    if (sort === "votes") return (b.forVotes + b.againstVotes + b.abstainVotes) - (a.forVotes + a.againstVotes + a.abstainVotes);
    if (sort === "title") return a.title.localeCompare(b.title);
    return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">{t("proposals.title")}</h1>
        <p className="text-slate-400">{t("proposals.summary", { total: formatNumber(proposals.length), active: formatNumber(activeCount) })}</p>
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
                : "bg-[#0d1520] border border-[#1a2535] text-slate-400 hover:border-blue-800 focus-visible:border-blue-800"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                {proposals.filter(p => p.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <label htmlFor="proposal-sort" className="text-sm text-slate-400">Sort proposals</label>
        <select id="proposal-sort" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="rounded-md border border-[#1e2d40] bg-[#0d1520] px-3 py-2 text-sm text-slate-300">
          <option value="recent">Most recent</option>
          <option value="votes">Most votes</option>
          <option value="title">Title</option>
        </select>
        <div role="group" aria-label="View density" className="ml-auto flex items-center gap-1 rounded-md border border-[#1e2d40] bg-[#0d1520] p-1">
          <button
            type="button"
            onClick={() => toggleDensity("cards")}
            aria-pressed={density === "cards"}
            aria-label="Card view"
            className={`p-1.5 rounded transition-colors ${density === "cards" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => toggleDensity("compact")}
            aria-pressed={density === "compact"}
            aria-label="Compact list view"
            className={`p-1.5 rounded transition-colors ${density === "compact" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            <List size={14} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">{t("proposals.empty")}</div>
      ) : density === "cards" ? (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(p => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[#1a2535] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a2535] text-left text-xs text-slate-500">
                <th scope="col" className="px-4 py-2.5">Status</th>
                <th scope="col" className="px-4 py-2.5">Title</th>
                <th scope="col" className="px-4 py-2.5 hidden sm:table-cell">Category</th>
                <th scope="col" className="px-4 py-2.5 hidden md:table-cell text-right">For / Against</th>
                <th scope="col" className="px-4 py-2.5 hidden lg:table-cell text-right">Quorum</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const total = p.forVotes + p.againstVotes + p.abstainVotes;
                const quorumPct = p.quorumRequired > 0 ? Math.min(100, Math.round((total / p.quorumRequired) * 100)) : 100;
                return (
                  <tr key={p.id} className="border-b border-[#0f1a28] last:border-0 hover:bg-[#0d1520] transition-colors">
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">
                      <Link href={`/proposals/${p.id}`} className="font-medium text-slate-200 hover:text-blue-300 transition-colors">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#162032] text-slate-400 border border-[#1e2d40]">{p.category}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-right text-xs">
                      <span className="text-emerald-400">{(p.forVotes / 1000).toFixed(0)}K</span>
                      {" / "}
                      <span className="text-red-400">{(p.againstVotes / 1000).toFixed(0)}K</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-right text-xs text-slate-400">{quorumPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
