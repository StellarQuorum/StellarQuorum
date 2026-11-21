"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { createQuorumClient } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { getWalletAdapter } from "@/lib/wallets";
import { useWallet } from "./WalletProvider";

const LEDGERS_PER_DAY = 17_280;
const MAX_LOCK_LEDGERS = 365 * LEDGERS_PER_DAY;

function amountInUnits(value: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d*)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

function formatAmount(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read staking data.";
}

export default function StakingPanel() {
  const { address, connect, activeWalletId, availableWallets, pending: walletPending } = useWallet();
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(30);
  const [decimals, setDecimals] = useState(7);
  const [ledger, setLedger] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [spendable, setSpendable] = useState<bigint | null>(null);
  const [locked, setLocked] = useState<bigint | null>(null);
  const [stake, setStake] = useState<{ amount: bigint; unlockLedger: number } | null>(null);
  const [previewRead, setPreviewRead] = useState<{ key: string; value: bigint } | null>(null);
  const [clockAnchor, setClockAnchor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { governanceContractId, useFixture } = getEnv();
  const tokenConfigured = Boolean(governanceContractId) && !useFixture;
  const parsedAmount = amountInUnits(amount, decimals);
  const durationLedgers = days * LEDGERS_PER_DAY;

  const refresh = useCallback(async () => {
    if (!address || !tokenConfigured) return;
    setLoading(true);
    setError("");
    try {
      const client = await createQuorumClient({ withToken: true });
      const [tokenDecimals, latest, currentBalance, available, lockedBalance, currentStake] = await Promise.all([
        client.getTokenDecimals(), client.getLatestLedger(), client.balance(address), client.spendableBalance(address),
        client.lockedBalance(address), client.getStake(address),
      ]);
      setDecimals(tokenDecimals);
      setLedger(latest);
      setClockAnchor(Date.now());
      setBalance(currentBalance);
      setSpendable(available);
      setLocked(lockedBalance);
      setStake(currentStake ? { amount: currentStake.amount, unlockLedger: currentStake.unlockLedger } : null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [address, tokenConfigured]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!tokenConfigured || !parsedAmount || parsedAmount <= 0n || days < 7 || days > 365 || !Number.isInteger(days)) {
      return;
    }
    let current = true;
    createQuorumClient({ withToken: true }).then(client => client.previewStakeBoost(parsedAmount, durationLedgers)).then(
      value => { if (current) setPreviewRead({ key: `${parsedAmount}:${durationLedgers}`, value }); },
      () => {},
    );
    return () => { current = false; };
  }, [days, durationLedgers, parsedAmount, tokenConfigured]);

  const currentBoost = useMemo(() => {
    if (!stake || ledger === null || ledger >= stake.unlockLedger) return 0n;
    return stake.amount * BigInt(stake.unlockLedger - ledger) / BigInt(MAX_LOCK_LEDGERS);
  }, [ledger, stake]);

  const durationValid = days >= 7 && days <= 365 && Number.isInteger(days);
  const previewKey = tokenConfigured && parsedAmount && parsedAmount > 0n && durationValid
    ? `${parsedAmount}:${durationLedgers}`
    : "";
  const preview = previewRead?.key === previewKey ? previewRead.value : null;

  async function submit(kind: "stake" | "unstake") {
    if (!address || !activeWalletId) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const client = await createQuorumClient({ withToken: true });
      const unsigned = kind === "stake"
        ? await client.buildStake(address, parsedAmount!, durationLedgers)
        : await client.buildUnstake(address);
      const adapter = getWalletAdapter(activeWalletId);
      if (!adapter) throw new Error("The connected wallet is not available. Reconnect it and try again.");
      const signed = await adapter.signTransaction(unsigned);
      await client.submitAndWait(signed);
      setMessage(kind === "stake" ? "Stake confirmed." : "Unstake confirmed. Tokens are spendable again.");
      setAmount("");
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const unlockDate = stake && ledger !== null && clockAnchor !== null
    ? new Date(clockAnchor + Math.max(0, stake.unlockLedger - ledger) * 5_000).toLocaleString()
    : null;
  const canStake = Boolean(address && tokenConfigured && !stake && parsedAmount && parsedAmount > 0n && spendable !== null && parsedAmount <= spendable && durationValid);
  const canUnstake = Boolean(address && stake && ledger !== null && ledger >= stake.unlockLedger);

  return (
    <section className="rounded-2xl border border-[#1a2535] bg-[#0d1520] p-5 sm:p-7" aria-label="Stake and unstake QUORUM">
      {!tokenConfigured && <p role="status" className="mb-5 rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-200">Staking needs a live governance deployment. Switch fixture mode off and configure NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID to enable on-chain staking.</p>}
      {!address ? (
        <button type="button" onClick={() => void connect()} disabled={walletPending || availableWallets.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {walletPending ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
          {availableWallets.length ? "Connect wallet" : "Install Freighter or Albedo"}
        </button>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            <Balance label="Total balance" value={balance} decimals={decimals} />
            <Balance label="Spendable" value={spendable} decimals={decimals} />
            <Balance label="Locked" value={locked} decimals={decimals} />
          </div>
          {stake ? (
            <div className="rounded-xl border border-blue-900/60 bg-[#080c10] p-4">
              <h2 className="font-semibold text-white">Active lock</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Fact label="Staked" value={`${formatAmount(stake.amount, decimals)} QUORUM`} />
                <Fact label="Unlocks" value={unlockDate ?? "Reading ledger…"} />
                <Fact label="Current boost" value={`${formatAmount(currentBoost, decimals)} QUORUM`} />
                <Fact label="Ledgers remaining" value={ledger === null ? "…" : Math.max(0, stake.unlockLedger - ledger).toLocaleString()} />
              </dl>
              <p className="mt-3 text-xs leading-5 text-slate-500">Boost decays linearly with the remaining lock time and reaches zero at the unlock ledger.</p>
              <button type="button" onClick={() => void submit("unstake")} disabled={!canUnstake || submitting} className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {submitting ? "Waiting for confirmation…" : canUnstake ? "Unstake" : "Unlock period not complete"}
              </button>
            </div>
          ) : (
            <div>
              <h2 className="font-semibold text-white">Start a lock</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px]">
                <label className="text-sm text-slate-400">Amount
                  <input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" aria-label="Stake amount in QUORUM" className="mt-1.5 w-full rounded-lg border border-[#1a2535] bg-[#080c10] px-3 py-2.5 font-mono text-white outline-none focus:border-blue-600" />
                </label>
                <label className="text-sm text-slate-400">Lock duration (days)
                  <input type="number" min={7} max={365} step={1} value={days} onChange={event => setDays(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-[#1a2535] bg-[#080c10] px-3 py-2.5 text-white outline-none focus:border-blue-600" />
                </label>
              </div>
              <div className="mt-4 rounded-lg bg-[#080c10] p-4" aria-live="polite">
                <p className="text-xs text-slate-500">Estimated voting boost on the first eligible snapshot</p>
                <p className="mt-1 font-mono text-lg text-white">{preview === null ? "Enter an amount" : `${formatAmount(preview, decimals)} QUORUM`}</p>
                <p className="mt-1 text-xs text-slate-500">Boost scales with lock duration (365 days is the maximum). It then decays linearly toward zero as the lock expires.</p>
              </div>
              <button type="button" onClick={() => void submit("stake")} disabled={!canStake || submitting} className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {submitting ? "Waiting for confirmation…" : "Stake QUORUM"}
              </button>
              {parsedAmount !== null && spendable !== null && parsedAmount > spendable && <p className="mt-2 text-xs text-amber-300">Amount exceeds your spendable balance.</p>}
              {amount && parsedAmount === null && <p className="mt-2 text-xs text-amber-300">Enter a valid amount with no more than {decimals} decimal places.</p>}
            </div>
          )}
        </>
      )}
      {loading && <p className="mt-4 text-xs text-slate-500">Refreshing on-chain balances…</p>}
      {message && <p role="status" className="mt-4 text-sm text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-4 break-words text-sm text-rose-300">{error}</p>}
    </section>
  );
}

function Balance({ label, value, decimals }: { label: string; value: bigint | null; decimals: number }) {
  return <div className="rounded-lg bg-[#080c10] p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-sm text-white">{value === null ? "—" : formatAmount(value, decimals)} <span className="text-xs text-slate-500">QUORUM</span></p></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-mono text-slate-200">{value}</dd></div>;
}
