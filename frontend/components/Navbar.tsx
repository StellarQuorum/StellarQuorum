'use client';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Scale } from "lucide-react";
import { useWallet } from "./WalletProvider";
import AccountSwitcher from "./AccountSwitcher";
import NotificationCenter from "./NotificationCenter";
import { t } from "@/lib/i18n";

export default function Navbar() {
  const { address, pending, error, connect } = useWallet();
  const pathname = usePathname();

  return (
    <nav className="border-b border-[#1a2535] bg-[#080c10]/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-blue-400 hover:text-blue-300 focus-visible:text-blue-300 transition-colors">
          <Scale size={20} />
          Quorum
        </Link>
        <div className="flex items-center gap-6 text-sm text-slate-400">
          <Link href="/proposals" className="hover:text-slate-200 hover:underline underline-offset-4 transition-colors">{t("nav.proposals")}</Link>
          <Link href="/create" className="hover:text-slate-200 hover:underline underline-offset-4 transition-colors">{t("nav.create")}</Link>
          <Link href="/delegation" className="hover:text-slate-200 hover:underline underline-offset-4 transition-colors">Delegation</Link>
          <Link href="/settings" className="hover:text-slate-200 hover:underline underline-offset-4 transition-colors">{t("nav.settings")}</Link>
          {address ? (
            <>
              <NotificationCenter address={address} />
              <AccountSwitcher />
            </>
          ) : (
            <button
              onClick={connect}
              disabled={pending}
              className="px-4 py-1.5 border border-blue-700 text-blue-400 hover:bg-blue-900/30 focus-visible:bg-blue-900/30 rounded-md transition-colors disabled:opacity-50"
            >
              {pending ? t("nav.connecting") : t("nav.connect")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="max-w-6xl mx-auto px-6 pb-3 text-xs text-amber-400">
          {error}
        </p>
      )}
    </nav>
  );
}
