'use client';

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { useWallet } from "./WalletProvider";
import { formatLedger, formatTokenAmount, getVotingPower, ZERO, type VotingPower } from "@/lib/voting-power";

/**
 * Shows the weight the connected wallet will vote with, before anything is
 * signed.
 *
 * The contract weights a vote by the voter's token balance at the proposal's
 * snapshot ledger, not their current balance, so the two disagree for anyone who
 * bought or sold after the proposal opened. That gap is invisible until the vote
 * is submitted and either succeeds with less weight than expected or fails
 * outright, so it is spelled out here — including the case where the weight is
 * zero, which the contract rejects with `NoVotingPower`.
 */
export default function VotingPowerPreview({ snapshotLedger }: { snapshotLedger: number }) {
  const { address } = useWallet();

  // The read is keyed by what it was for, so a wallet switch or a different
  // proposal cannot briefly show the previous answer, and "no answer yet" needs
  // no state of its own.
  const readFor = `${address ?? ""}@${snapshotLedger}`;
  const [read, setRead] = useState<{ readFor: string; state: State } | null>(null);

  useEffect(() => {
    if (!address) return;
    let current = true;
    getVotingPower(address, snapshotLedger).then(
      power => current && setRead({ readFor, state: { status: "ready", power } }),
      error => current && setRead({ readFor, state: { status: "error", message: describeError(error) } }),
    );
    return () => {
      current = false;
    };
  }, [address, snapshotLedger, readFor]);

  const state = read?.readFor === readFor ? read.state : null;

  return (
    <div className="rounded-lg border border-[#1a2535] bg-[#080c10] p-4 mb-4" aria-live="polite">
      {!address ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Wallet size={15} aria-hidden />
          Connect your wallet to see the weight this proposal will count.
        </p>
      ) : !state ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Reading your balance at ledger #{formatLedger(snapshotLedger)}…
        </p>
      ) : state.status === "error" ? (
        <ReadFailure message={state.message} />
      ) : state.power.snapshot <= ZERO ? (
        <NoVotingPower power={state.power} snapshotLedger={snapshotLedger} />
      ) : (
        <VoteWeight power={state.power} snapshotLedger={snapshotLedger} />
      )}
    </div>
  );
}

type State =
  | { status: "error"; message: string }
  | { status: "ready"; power: VotingPower };

/**
 * A zero snapshot balance is not a UI state the voter can act on, so it is
 * named as one: which ledger decided it, what the contract does about it, and
 * why a wallet showing a balance is not enough.
 */
function NoVotingPower({ power, snapshotLedger }: { power: VotingPower; snapshotLedger: number }) {
  return (
    <div className="flex gap-2.5">
      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-white">No voting power on this proposal</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Your QUORUM balance at snapshot ledger <Ledger snapshotLedger={snapshotLedger} /> — the
          ledger recorded when this proposal was created — was 0, so the contract rejects a vote
          from this address with <code className="font-mono text-slate-300">NoVotingPower</code>.
          {power.current > ZERO && (
            <>
              {" "}
              This wallet holds {formatTokenAmount(power.current, power.decimals)} QUORUM now. Tokens
              acquired after ledger <Ledger snapshotLedger={snapshotLedger} /> carry no weight on a
              proposal that was already open.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function VoteWeight({ power, snapshotLedger }: { power: VotingPower; snapshotLedger: number }) {
  const drifted = power.current !== power.snapshot;
  return (
    <div>
      <p className="text-xs text-slate-500">You will vote with</p>
      <p className="text-lg font-bold text-white font-mono mt-0.5">
        {formatTokenAmount(power.snapshot, power.decimals)}{" "}
        <span className="text-slate-500 text-sm font-sans">QUORUM</span>
      </p>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
        Voting power is your QUORUM balance at snapshot ledger{" "}
        <Ledger snapshotLedger={snapshotLedger} />, not your current balance.
        {drifted && (
          <>
            {" "}
            This wallet holds {formatTokenAmount(power.current, power.decimals)} QUORUM now — the
            difference is not counted on this proposal.
          </>
        )}
      </p>
    </div>
  );
}

/** A read that failed is not a zero weight, and must never be shown as one. */
function ReadFailure({ message }: { message: string }) {
  return (
    <div className="flex gap-2.5">
      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-white">Voting power unavailable</p>
        <p className="text-xs text-slate-400 mt-1">{message}</p>
      </div>
    </div>
  );
}

function Ledger({ snapshotLedger }: { snapshotLedger: number }) {
  return <span className="font-mono text-slate-300">#{formatLedger(snapshotLedger)}</span>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "The balance at the snapshot ledger could not be read.";
}
