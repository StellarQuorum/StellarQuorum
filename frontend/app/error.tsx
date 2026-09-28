"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { t } from "@/lib/i18n";

/*
 * Error boundaries must be client components — `reset` and the error/digest
 * props only exist on the client. This one covers every segment below the
 * root layout; an error thrown by the layout itself needs `global-error.tsx`.
 *
 * The message is deliberately not rendered: Next.js only exposes it in
 * development, and printing it in production would disclose internals. The
 * digest is the safe correlate — it matches the server log entry, so support
 * can find the full error without it ever reaching the browser.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-14 h-14 rounded-full bg-[#0d1520] border border-[#1a2535] flex items-center justify-center mb-6">
        <AlertTriangle size={28} className="text-blue-400" />
      </div>
      <h1 className="text-3xl font-bold text-white mb-3">{t("error.title")}</h1>
      <p className="max-w-md text-slate-400 leading-relaxed mb-8">{t("error.description")}</p>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
        >
          {t("error.tryAgain")}
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 border border-[#1a2535] hover:border-blue-700 text-slate-300 rounded-lg font-semibold transition-colors"
        >
          <ArrowLeft size={16} />
          {t("error.backHome")}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs font-mono text-slate-600">
          {t("error.reference", { digest: error.digest })}
        </p>
      )}
    </div>
  );
}
