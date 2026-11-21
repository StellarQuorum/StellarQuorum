"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createQuorumClient, USE_FIXTURE } from "../lib/config";
import { useWallet } from "./WalletProvider";

type ActionPhase = "Ended" | "ReadyToExecute";
const REFRESH_MS = 10_000;

/** Permissionless proposal lifecycle calls, paid for and authorized by the connected wallet. */
export default function ProposalLifecycleActions({ proposalId }: { proposalId: string }) {
  const { address, activeWalletId, availableWallets, connect, pending } = useWallet();
  const [phase, setPhase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof createQuorumClient> | null>(null);

  const numericId = /^QIP-(\d+)$/.exec(proposalId)?.[1];
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = createQuorumClient().catch((error: unknown) => {
        clientRef.current = null;
        throw error;
      });
    }
    return clientRef.current;
  }, []);
  const refreshPhase = useCallback(async () => {
    if (USE_FIXTURE || !numericId) return;
    try {
      const client = await getClient();
      const nextPhase = await client.getProposalPhase(BigInt(numericId));
      setPhase(nextPhase);
    } catch {
      // A failed phase read should not offer a transaction from stale UI state.
      setPhase(null);
    }
  }, [getClient, numericId]);

  useEffect(() => {
    const initialRead = window.setTimeout(() => void refreshPhase(), 0);
    const timer = window.setInterval(() => void refreshPhase(), REFRESH_MS);
    return () => {
      window.clearTimeout(initialRead);
      window.clearInterval(timer);
    };
  }, [refreshPhase]);

  const action: ActionPhase | null = phase === "Ended"
    ? "Ended"
    : phase === "ReadyToExecute"
      ? "ReadyToExecute"
      : null;

  async function submit() {
    if (!address || !activeWalletId || !numericId || !action) return;
    const wallet = availableWallets.find((candidate) => candidate.id === activeWalletId);
    if (!wallet) {
      setMessage("Reconnect your wallet to continue.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const client = await getClient();
      const unsignedXdr = action === "Ended"
        ? await client.buildFinalize(address, BigInt(numericId))
        : await client.buildExecute(address, BigInt(numericId));
      const signedXdr = await wallet.signTransaction(unsignedXdr);
      await client.submitAndWait(signedXdr);
      setMessage(action === "Ended" ? "Proposal finalized successfully." : "Proposal executed successfully.");
      await refreshPhase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The transaction could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (USE_FIXTURE || !action) return null;

  return (
    <section aria-label="Proposal lifecycle actions" className="p-5 rounded-xl bg-[#0d1520] border border-amber-800/40 mb-6 print:hidden">
      <h2 className="font-semibold text-white mb-2">{action === "Ended" ? "Finalize proposal" : "Execute proposal"}</h2>
      <p className="text-sm text-slate-400 mb-4">
        {action === "Ended"
          ? "Voting has ended. Finalizing records the outcome and starts the timelock for passed proposals."
          : "The timelock has elapsed. Execute this proposal on chain."}
      </p>
      {!address ? (
        <button type="button" disabled={pending} onClick={() => void connect()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          {pending ? "Connecting…" : "Connect wallet to continue"}
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
          {busy ? "Waiting for confirmation…" : action === "Ended" ? "Finalize" : "Execute"}
        </button>
      )}
      {message && <p role="status" className="mt-3 text-sm text-slate-300">{message}</p>}
    </section>
  );
}
