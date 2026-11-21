'use client';

import { WifiOff, RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";

/*
 * Offline fallback page. This is shown when the service worker detects the
 * browser has no network connectivity. The app displays live governance data
 * from the Stellar network, so it cannot function offline — this page explains
 * that limitation and offers a retry button.
 */
export default function OfflinePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-14 h-14 rounded-full bg-[#0d1520] border border-[#1a2535] flex items-center justify-center mb-6">
        <WifiOff size={28} className="text-blue-400" />
      </div>
      <h1 className="text-3xl font-bold text-white mb-3">{t("offline.title")}</h1>
      <p className="max-w-md text-slate-400 leading-relaxed mb-8">{t("offline.description")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
      >
        <RefreshCw size={16} />
        {t("offline.retry")}
      </button>
    </div>
  );
}
