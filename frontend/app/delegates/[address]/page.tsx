import Link from "next/link";
import { participationFor } from "@/lib/delegates";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import { getProposals } from "@/lib/proposals";
import { truncateAddress } from "@/lib/voters";

export default async function DelegateHistoryPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const entries = participationFor(address, await getProposals());

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/delegates" className="text-sm text-blue-400 hover:text-blue-300">← {t("delegates.back")}</Link>
      <h1 className="mt-6 text-3xl font-bold text-white">{t("delegates.history")}</h1>
      <p className="mt-2 text-slate-400">{t("delegates.historyIntro", { address: truncateAddress(address) })}</p>

      {entries.length === 0 ? (
        <p role="status" className="mt-8 p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] text-sm text-slate-400">
          {t("delegates.noHistory")}
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-[#1a2535] bg-[#0d1520]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("delegates.viewHistory", { address })}</caption>
            <thead className="border-b border-[#1a2535] text-slate-400">
              <tr>
                <th scope="col" className="p-4">{t("delegates.proposal")}</th>
                <th scope="col" className="p-4">{t("proposals.choice")}</th>
                <th scope="col" className="p-4">{t("proposals.weight")}</th>
                <th scope="col" className="p-4">{t("proposals.time")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={`${entry.proposalId}-${entry.timestamp}`} className="border-b border-[#1a2535] last:border-0">
                  <td className="p-4">
                    <Link href={`/proposals/${entry.proposalId}`} className="text-blue-400 hover:text-blue-300">{entry.title}</Link>
                  </td>
                  <td className="p-4 text-slate-300">{t(`common.${entry.choice}`)}</td>
                  <td className="p-4 text-white">{formatNumber(entry.weight)} QUORUM</td>
                  <td className="p-4 text-slate-400">{formatDate(entry.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
