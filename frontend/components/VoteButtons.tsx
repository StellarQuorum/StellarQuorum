'use client';

// Split out of the proposal detail page so that page can stay a server
// component; the buttons need onClick.
export default function VoteButtons() {
  return (
    <div className="flex gap-3 mb-3">
      <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} aria-label="Vote For proposal" className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">Vote For</button>
      <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} className="flex-1 py-2.5 rounded-lg bg-red-800 hover:bg-red-700 text-white font-semibold text-sm transition-colors">Vote Against</button>
      <button onClick={() => alert("Connect your Freighter wallet to vote. Testnet integration in progress.")} className="flex-1 py-2.5 rounded-lg bg-[#162032] hover:bg-[#1a2a40] text-slate-300 font-semibold text-sm border border-[#1a2535] transition-colors">Abstain</button>
    </div>
  );
}
