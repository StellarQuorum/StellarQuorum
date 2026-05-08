'use client';
import Link from "next/link";
import { Scale } from "lucide-react";

export default function Navbar() {
  return (
    <nav className="border-b border-[#1a2535] bg-[#080c10]/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-blue-400 hover:text-blue-300 transition-colors">
          <Scale size={20} />
          Quorum
        </Link>
        <div className="flex items-center gap-6 text-sm text-slate-400">
          <Link href="/proposals" className="hover:text-slate-200 transition-colors">Proposals</Link>
          <Link href="/create" className="hover:text-slate-200 transition-colors">Create</Link>
          <button
            onClick={() => alert("Freighter wallet integration coming soon — testnet deployment in progress.")}
            className="px-4 py-1.5 border border-blue-700 text-blue-400 hover:bg-blue-900/30 rounded-md transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    </nav>
  );
}
