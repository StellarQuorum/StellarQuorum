import { formatLedger, formatTokenAmount, getVotingPower, unitsOf } from "./voting-power";
import { TOKEN_DECIMALS } from "./config";

// Voting power is the one number a voter cannot check for themselves: it comes
// from a ledger they have to trust and may not remember. These cover the two
// facts the preview is built on — the weight is the snapshot balance, and a
// zero snapshot balance is a real answer rather than a missing one.
describe("formatTokenAmount", () => {
  it("renders whole token amounts with thousands separators", () => {
    expect(formatTokenAmount(unitsOf(2_500), 7)).toBe("2,500");
    expect(formatTokenAmount(unitsOf(150_000), 7)).toBe("150,000");
    expect(formatTokenAmount(BigInt(0), 7)).toBe("0");
  });

  it("keeps a fractional remainder instead of truncating the weight", () => {
    expect(formatTokenAmount(BigInt(15_000_000), 7)).toBe("1.5");
    expect(formatTokenAmount(BigInt(1_234_567), 7)).toBe("0.1234");
  });

  it("defaults to the token's on-chain decimals", () => {
    expect(TOKEN_DECIMALS).toBe(7);
    expect(formatTokenAmount(unitsOf(2_500))).toBe("2,500");
  });

  it("keeps full precision on supply-sized amounts", () => {
    // Past Number.MAX_SAFE_INTEGER, so the grouping cannot go through Intl or
    // any arithmetic on a JS number without losing the last digit.
    expect(formatTokenAmount(unitsOf(BigInt("9007199254740993")), 7)).toBe("9,007,199,254,740,993");
  });
});

describe("formatLedger", () => {
  it("groups the sequence the way it is written on a block explorer", () => {
    expect(formatLedger(61_284_512)).toBe("61,284,512");
  });
});

describe("getVotingPower", () => {
  it("reports the snapshot balance, not the current one", async () => {
    // Fixture mode: ...3XZK bought more after the snapshot, so only the earlier
    // balance is weighted.
    const power = await getVotingPower("GABCDEFGHIJKLMNOP3XZK", 61_284_512);
    expect(power.snapshot).toBe(unitsOf(2_500));
    expect(power.current).toBe(unitsOf(4_000));
    expect(power.decimals).toBe(TOKEN_DECIMALS);
  });

  it("returns a zero snapshot balance for an address that held nothing then", async () => {
    const power = await getVotingPower("GNOPQRSTUVWXYZ9QSX", 61_284_512);
    expect(power.snapshot).toBe(BigInt(0));
  });

  it("keeps the two balances distinct so a post-snapshot buy is visible", async () => {
    const power = await getVotingPower("GABCDEFGHIJKLMNOP3XZK", 61_284_512);
    expect(power.snapshot).not.toBe(power.current);
  });
});
