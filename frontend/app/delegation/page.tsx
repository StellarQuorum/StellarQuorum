'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DelegatedEvent } from "@quorum/sdk";
import { useWallet } from "@/components/WalletProvider";
import { t } from "@/lib/i18n";
import { createQuorumClient, USE_FIXTURE } from "@/lib/config";

type DelegationChange = DelegatedEvent & { ledger: number };

export default function DelegationPage() {
  const { address, connect, pending } = useWallet();
  const [history, setHistory] = useState<DelegationChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setHistory([]); setError(null); return; }
    if (USE_FIXTURE) { setHistory([]); setError(t("delegation.liveNetworkRequired")); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void createQuorumClient()
      .then(client => client.getDelegationEvents(address))
      .then(events => { if (!cancelled) setHistory(events); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← {t("common.quorum")}</Link>
      <h1 className="mt-6 text-3xl font-bold text-white">{t("delegation.title")}</h1>
      <p className="mt-2 text-slate-400">{t("delegation.intro")}</p>
      {!address ? (
        <section role="status" className="mt-8 rounded-xl border border-[#1a2535] bg-[#0d1520] p-6 text-center">
          <p className="text-slate-300">{t("delegation.connectPrompt")}</p>
          <button type="button" onClick={() => void connect()} disabled={pending} className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? t("nav.connecting") : t("nav.connect")}
          </button>
        </section>
      ) : loading ? (
        <p role="status" className="mt-8 text-slate-400">{t("delegation.loading")}</p>
      ) : error ? (
        <p role="alert" className="mt-8 rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-300">{t("delegation.loadError", { error })}</p>
      ) : history.length === 0 ? (
        <p role="status" className="mt-8 rounded-xl border border-[#1a2535] bg-[#0d1520] p-6 text-slate-400">{t("delegation.empty")}</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-[#1a2535] bg-[#0d1520]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("delegation.title")}</caption>
            <thead className="border-b border-[#1a2535] text-slate-400"><tr><th scope="col" className="p-4">{t("delegation.ledger")}</th><th scope="col" className="p-4">{t("delegation.delegator")}</th><th scope="col" className="p-4">{t("delegation.delegate")}</th><th scope="col" className="p-4">{t("delegation.status")}</th></tr></thead>
            <tbody>{history.map((row, index) => {
              const revoked = row.delegatee === row.delegator;
              return <tr key={`${row.ledger}-${index}`} className="border-b border-[#1a2535] last:border-0">
                <td className="p-4 text-slate-300">#{row.ledger}</td>
                <td className="p-4 font-mono text-slate-400">{row.delegator}</td>
                <td className="p-4 font-mono text-slate-400">{revoked ? t("delegation.self") : row.delegatee}</td>
                <td className="p-4 text-slate-300">{revoked ? t("delegation.revoked") : t("delegation.active")}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
