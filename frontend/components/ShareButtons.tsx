"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Send } from "lucide-react";

/** How long the "Copied" checkmark stays up after a successful copy. */
const COPIED_RESET_MS = 2000;

const SHARE_HANDLE = "@QuorumGovernance";

/**
 * Copy-link, X and Telegram share buttons for a proposal. Issue #37.
 *
 * `url` is the proposal's canonical link, built by the server page from the
 * validated site origin, so the shared link always points at this deployment.
 */
export default function ShareButtons({ id, title, url }: { id: string; title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const text = `Vote on ${id}: ${title} on ${SHARE_HANDLE}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access is denied or unavailable (e.g. an insecure origin);
      // leave the button as it was rather than claim a copy that did not happen.
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  const buttonClass =
    "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[#162032] border border-[#1e2d40] text-slate-400 hover:text-slate-200 hover:border-blue-800 transition-colors";

  return (
    <div className="flex items-center gap-2 flex-wrap print:hidden">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Link copied" : "Copy link to this proposal"}
        className={buttonClass}
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy Link"}
      </button>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this proposal on X"
        className={buttonClass}
      >
        <span aria-hidden="true" className="font-bold leading-none">𝕏</span> Share on X
      </a>
      <a
        href={telegramUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this proposal on Telegram"
        className={buttonClass}
      >
        <Send size={13} /> Share on Telegram
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied to clipboard" : ""}
      </span>
    </div>
  );
}
