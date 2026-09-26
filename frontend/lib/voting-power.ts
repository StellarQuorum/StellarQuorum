import { TOKEN_DECIMALS, USE_FIXTURE, createQuorumClient } from "./config";

/**
 * Snapshot balances served in fixture mode, keyed by the last four characters of
 * an address. The keys match the shortened addresses already printed by the
 * fixture proposals, so a demo can paste one into a connect flow:
 *
 * - `...3XZK` holds 2,500 QUORUM at the snapshot but 4,000 now — a voter who
 *   bought more after the proposal opened, and whose extra balance is not
 *   counted.
 * - `...7MKL` holds 150,000 QUORUM at the snapshot and the same now, so the
 *   two numbers agree and the preview has nothing to warn about.
 *
 * Any other address holds nothing at the snapshot. That is the case the preview
 * exists to explain: a wallet showing tokens that carry no weight on a proposal
 * already open.
 *
 * Amounts are raw token units, as they are on chain.
 */
const FIXTURE_BALANCES: Record<string, { snapshot: string; current: string }> = {
  "3XZK": { snapshot: "25000000000", current: "40000000000" },
  "7MKL": { snapshot: "1500000000000", current: "1500000000000" },
};

export interface VotingPower {
  /**
   * Balance at the proposal's snapshot ledger. This is the weight the vote is
   * cast with, and zero means the contract rejects the vote outright.
   */
  snapshot: bigint;
  /**
   * Live balance. Never used to weight a vote; it is read so the UI can show
   * how far it has drifted from the snapshot the ballot is decided by.
   */
  current: bigint;
  /** Decimals to render both amounts with. */
  decimals: number;
}

/**
 * The weight `address` would cast on a proposal snapshotted at `snapshotLedger`,
 * read before any vote is signed.
 *
 * @throws Whatever the RPC read throws, so the caller can distinguish "no
 *   balance" from "could not check".
 */
export async function getVotingPower(address: string, snapshotLedger: number): Promise<VotingPower> {
  if (USE_FIXTURE) {
    const fixture = FIXTURE_BALANCES[address.slice(-4)];
    return {
      snapshot: BigInt(fixture?.snapshot ?? "0"),
      current: BigInt(fixture?.current ?? "0"),
      decimals: TOKEN_DECIMALS,
    };
  }

  const client = await createQuorumClient();
  const [snapshot, current, decimals] = await Promise.all([
    client.getVotingPower(address, snapshotLedger),
    client.getBalance(address),
    // Decimals are cosmetic; a failed read must not hide the vote weight.
    client.getTokenDecimals().catch(() => TOKEN_DECIMALS),
  ]);
  return { snapshot, current, decimals };
}

/** Balances and weights are token amounts, which do not fit a JS number. */
export const ZERO = BigInt(0);

/**
 * A whole-token amount in raw units, e.g. `unitsOf(2_500)` is 2,500 QUORUM.
 *
 * Takes a bigint as well as a number because supply-sized amounts do not fit a
 * JS number, and the build targets ES2017, which predates bigint literals, so
 * the conversion is written out rather than spelled `2_500n`.
 */
export function unitsOf(amount: number | bigint, decimals = TOKEN_DECIMALS): bigint {
  return BigInt(amount) * BigInt(10) ** BigInt(decimals);
}

/**
 * Renders raw token units as an amount, e.g. `BigInt(25000000000)` at 7
 * decimals as "2,500".
 *
 * Grouping is done on the digit string rather than through `Intl` so that
 * supply-sized amounts keep full precision: a token amount in raw units can
 * exceed `Number.MAX_SAFE_INTEGER`.
 */
export function formatTokenAmount(units: bigint, decimals = TOKEN_DECIMALS): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = groupDigits((units / scale).toString());
  const fraction = units % scale;
  if (fraction <= ZERO) return whole;
  // Balances are exact on chain but unreadable at seven places, so keep at most
  // four decimals and drop trailing zeros.
  const trimmed = fraction.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole}.${trimmed}`;
}

/** Ledger sequence as a reader would write it, e.g. 61_284_512 as "61,284,512". */
export function formatLedger(ledger: number): string {
  return ledger.toLocaleString("en-US");
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
