import Link from "next/link";
import { createQuorumClient, USE_FIXTURE } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const config = USE_FIXTURE ? null : await (await createQuorumClient()).getConfig();
  return <div className="max-w-3xl mx-auto px-6 py-12">
    <Link href="/" className="text-sm text-slate-500 hover:text-slate-300">← Back home</Link>
    <h1 className="text-3xl font-bold text-white mt-6 mb-2">Admin &amp; guardian console</h1>
    <p className="text-slate-400 mb-8">Read-only governance controls and role visibility. Transaction signing remains wallet-gated.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]"><h2 className="font-semibold text-white mb-2">Administrator</h2><p className="font-mono text-xs text-slate-400 break-all">{config?.admin ?? "Fixture mode"}</p><p className="text-xs text-slate-500 mt-3">Can manage governance configuration and proposals.</p></div>
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]"><h2 className="font-semibold text-white mb-2">Guardian</h2><p className="font-mono text-xs text-slate-400 break-all">{config?.guardian ?? "Fixture mode"}</p><p className="text-xs text-slate-500 mt-3">Can veto queued proposals during the timelock.</p></div>
    </div>
    {config && <div className="mt-6 p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] text-sm text-slate-400">Protocol is <span className="text-white">{config.paused ? "paused" : "active"}</span>. Voting period: {config.votingPeriod} ledgers · Timelock: {config.timelockPeriod} ledgers.</div>}
  </div>;
}
