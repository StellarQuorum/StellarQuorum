import { PROPOSALS, getProposalById, getProposals, toUiProposal } from "./proposals";

// Issue #177: frontend previously had no test script at all, so
// `npm test -- --passWithNoTests` at the root passed vacuously. This is a
// real regression test of getProposalById's lookup behavior.
// No contract ID is configured under Jest, so these exercise fixture mode.
describe("getProposalById", () => {
  it("returns the matching proposal for a known id", async () => {
    const first = PROPOSALS[0];
    expect(await getProposalById(first.id)).toEqual(first);
  });

  it("returns undefined for an unknown id", async () => {
    expect(await getProposalById("QIP-does-not-exist")).toBeUndefined();
  });

  it("is case-sensitive", async () => {
    const first = PROPOSALS[0];
    expect(await getProposalById(first.id.toLowerCase())).toBeUndefined();
  });
});

describe("getProposals", () => {
  it("falls back to the fixture without a configured contract", async () => {
    expect(await getProposals()).toBe(PROPOSALS);
  });
});

// Issue #132: shape of contract data as rendered by the UI.
describe("toUiProposal", () => {
  const chain = {
    id: BigInt(7),
    proposer: "GABC",
    title: "T",
    description: "D",
    forVotes: BigInt(100),
    againstVotes: BigInt(20),
    abstainVotes: BigInt(5),
    snapshotLedger: 999,
    startLedger: 1000,
    endLedger: 1012,
    queueLedger: 0,
    quorumRequired: BigInt(50),
    status: "Queued" as const,
  };

  it("maps ids, amounts, status and ledger times", () => {
    const now = Date.UTC(2026, 0, 1);
    const ui = toUiProposal(chain, 1000, now);
    expect(ui).toMatchObject({
      id: "QIP-007",
      status: "passed",
      forVotes: 100,
      quorumRequired: 50,
      startTime: new Date(now).toISOString(),
      endTime: new Date(now + 60_000).toISOString(),
      actions: [],
      votes: [],
    });
  });

  it("lower-cases the other statuses", () => {
    expect(toUiProposal({ ...chain, status: "Active" }, 0).status).toBe("active");
  });
});
