import Link from "next/link";
import { DELEGATES_BLOCKED_ON, getDelegates, rankDelegates } from "@/lib/delegates";
import { formatNumber, t } from "@/lib/i18n";
import { truncateAddress } from "@/lib/voters";

export default async function DelegatesPage() {
  const delegates = rankDelegates(await getDelegates());

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← Quorum</Link>
      <h1 className="mt-6 text-3xl font-bold text-white">{t("delegates.title")}</h1>
      <p className="mt-2 text-slate-400">{t("delegates.intro")}</p>

      {delegates.length === 0 ? (
        <p role="status" className="mt-8 p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] text-sm text-slate-400">
          {t("delegates.blocked", { issues: DELEGATES_BLOCKED_ON })}
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-[#1a2535] bg-[#0d1520]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("delegates.title")}</caption>
            <thead className="border-b border-[#1a2535] text-slate-400">
              <tr>
                <th scope="col" className="p-4">{t("delegates.delegate")}</th>
                <th scope="col" className="p-4">{t("delegates.weight")}</th>
                <th scope="col" className="p-4">{t("delegates.delegators")}</th>
                <th scope="col" className="p-4">{t("delegates.history")}</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map(delegate => (
                <tr key={delegate.address} className="border-b border-[#1a2535] last:border-0">
                  <td className="p-4 font-mono text-slate-300" title={delegate.address}>{truncateAddress(delegate.address)}</td>
                  <td className="p-4 text-white">{formatNumber(delegate.delegatedWeight)} QUORUM</td>
                  <td className="p-4 text-slate-300">{formatNumber(delegate.delegatorCount)}</td>
                  <td className="p-4">
                    <Link
                      href={`/delegates/${encodeURIComponent(delegate.address)}`}
                      aria-label={t("delegates.viewHistory", { address: delegate.address })}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {t("delegates.history")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
