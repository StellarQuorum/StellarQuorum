"use client";

import { useEffect, useState } from "react";
import type { Proposal } from "@/lib/types";

/** How often the detail page re-reads a proposal while it is visible (issue #41). */
export const LIVE_POLL_INTERVAL_MS = 10_000;

interface LiveProposal {
  proposal: Proposal;
  /** Epoch milliseconds of the last successful read. */
  lastUpdated: number;
}

/**
 * Keeps `initial` fresh by polling `/api/proposals/{id}` every
 * `LIVE_POLL_INTERVAL_MS`. Polling runs only while the tab is visible; when the
 * tab comes back it reads once straight away, then resumes the interval.
 *
 * A failed read keeps the last known proposal, so a flaky RPC never blanks the page.
 */
export function useLiveProposal(initial: Proposal): LiveProposal {
  const [state, setState] = useState<LiveProposal>(() => ({ proposal: initial, lastUpdated: Date.now() }));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/proposals/${encodeURIComponent(initial.id)}`, { cache: "no-store" });
        if (!response.ok) return;
        const proposal = (await response.json()) as Proposal;
        if (!cancelled) setState({ proposal, lastUpdated: Date.now() });
      } catch {
        // Offline or RPC down: keep showing the last counts.
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, LIVE_POLL_INTERVAL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initial.id]);

  return state;
}
