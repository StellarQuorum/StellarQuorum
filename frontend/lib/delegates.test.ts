import { getDelegates, participationFor, rankDelegates, type DelegateSummary } from "./delegates";
import type { Proposal } from "./types";

// Issue #280: the directory ranks delegates and shows each one's voting history.

const DELEGATES: DelegateSummary[] = [
  { address: "GBBB...2222", delegatedWeight: 500, delegatorCount: 3 },
  { address: "GAAA...1111", delegatedWeight: 900, delegatorCount: 1 },
  { address: "GCCC...3333", delegatedWeight: 500, delegatorCount: 7 },
];

describe("rankDelegates", () => {
  it("orders delegates by delegated weight, heaviest first", () => {
    expect(rankDelegates(DELEGATES).map(delegate => delegate.address)).toEqual([
      "GAAA...1111",
      "GBBB...2222",
      "GCCC...3333",
    ]);
  });

  it("breaks ties by address so the order does not change between renders", () => {
    const reversed = [...DELEGATES].reverse();
    expect(rankDelegates(reversed)).toEqual(rankDelegates(DELEGATES));
  });

  it("does not reorder the array it was given", () => {
    const input = [...DELEGATES];
    rankDelegates(input);
    expect(input).toEqual(DELEGATES);
  });
});

describe("getDelegates", () => {
  it("returns no delegates until the SDK can list delegation totals", async () => {
    await expect(getDelegates()).resolves.toEqual([]);
  });
});

describe("participationFor", () => {
  const proposals = [
    {
      id: "QIP-001",
      title: "First",
      votes: [
        { voter: "GAAA...1111", choice: "for", weight: 10, timestamp: "2026-05-01T10:00:00Z" },
        { voter: "GZZZ...9999", choice: "against", weight: 5, timestamp: "2026-05-01T11:00:00Z" },
      ],
    },
    {
      id: "QIP-002",
      title: "Second",
      votes: [{ voter: "GAAA...1111", choice: "abstain", weight: 12, timestamp: "2026-05-09T08:00:00Z" }],
    },
  ] as unknown as Proposal[];

  it("lists only the votes cast by the address, most recent first", () => {
    expect(participationFor("GAAA...1111", proposals)).toEqual([
      { proposalId: "QIP-002", title: "Second", choice: "abstain", weight: 12, timestamp: "2026-05-09T08:00:00Z" },
      { proposalId: "QIP-001", title: "First", choice: "for", weight: 10, timestamp: "2026-05-01T10:00:00Z" },
    ]);
  });

  it("returns an empty history for an address that never voted", () => {
    expect(participationFor("GNONE...0000", proposals)).toEqual([]);
  });
});
