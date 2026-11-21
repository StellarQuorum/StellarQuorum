import Link from "next/link";
import StakingPanel from "@/components/StakingPanel";

export default function StakingPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/proposals" className="text-sm text-slate-500 hover:text-slate-300">← Governance</Link>
      <header className="my-8">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Vote-escrow</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Stake QUORUM</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Lock tokens for 7 to 365 days. Your vote boost starts with the selected lock duration and decays linearly to zero as the unlock ledger approaches.</p>
      </header>
      <StakingPanel />
    </div>
  );
}
