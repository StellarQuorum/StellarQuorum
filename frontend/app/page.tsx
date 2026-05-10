import Link from "next/link";
import { Scale, Vote, CheckSquare, ArrowRight } from "lucide-react";
import { PROPOSALS } from "@/lib/proposals";
import ProposalCard from "@/components/ProposalCard";

export default function Home() {
  const activeCount = PROPOSALS.filter(p => p.status === "active").length;
  const recentProposals = PROPOSALS.slice(0, 4);

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="py-20 sm:py-24 px-4 sm:px-6 text-center border-b border-[#1a2535]">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-900/30 border border-blue-700/50 text-blue-400 text-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            {activeCount} Active Proposals &middot; Stellar Ecosystem
          </div>
          <h1 className="text-5xl font-bold text-white mb-5 leading-tight">
            Decentralized Governance for the{" "}
            <span className="text-blue-400">Stellar Ecosystem</span>
          </h1>
          <p className="text-xl text-slate-400 mb-8 leading-relaxed">
            Quorum provides the primitives for on-chain proposal creation, token-weighted voting, delegation, and transparent execution — built on Soroban.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/proposals" className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors">
              View Proposals
            </Link>
            <Link href="/create" className="px-8 py-3 border border-[#1a2535] hover:border-blue-700 text-slate-300 rounded-lg font-semibold transition-colors">
              Create Proposal
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-10 border-b border-[#1a2535] bg-[#0a0f18]">
        <div className="max-w-4xl mx-auto px-6 flex justify-center gap-16 text-center">
          {[
            { value: "8", label: "Total Proposals" },
            { value: `${activeCount}`, label: "Active Votes" },
            { value: "1.2M", label: "XLM Governed" },
          ].map(s => (
            <div key={s.label}>
              <div className="text-3xl font-bold text-blue-400">{s.value}</div>
              <div className="text-sm text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Proposals */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-white">Recent Proposals</h2>
            <Link href="/proposals" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {recentProposals.map(p => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-6 border-t border-[#1a2535] bg-[#0a0f18]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-12">How Quorum Works</h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            {[
              { icon: <Scale size={28} className="text-blue-400 mx-auto" />, step: "01", title: "Create", desc: "Any token holder with sufficient QUORUM balance can submit a proposal with on-chain actions and a voting window." },
              { icon: <Vote size={28} className="text-blue-400 mx-auto" />, step: "02", title: "Vote", desc: "Token holders vote For, Against, or Abstain. Voting power is proportional to token balance at the proposal snapshot." },
              { icon: <CheckSquare size={28} className="text-blue-400 mx-auto" />, step: "03", title: "Execute", desc: "Proposals that reach quorum and majority are queued in a 48-hour timelock before on-chain execution." },
            ].map(s => (
              <div key={s.step} className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[#0d1520] border border-[#1a2535] flex items-center justify-center">
                  {s.icon}
                </div>
                <div className="text-xs text-blue-500 font-mono">{s.step}</div>
                <h3 className="font-semibold text-white">{s.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
