import { createQuorumClient, USE_FIXTURE } from "./config";
import type { Proposal } from "./types";

// Fixture quorum values use 5% of a 10,000,000-unit circulating supply.
export const FIXTURE_CIRCULATING_SUPPLY = 10_000_000;

export interface TrendPoint {
  label: string;
  value: number;
}

export interface MonthlyProposalStats {
  label: string;
  passed: number;
  failed: number;
  active: number;
  other: number;
  quorumRate: number | null;
}

export interface CategoryVoteSplit {
  category: string;
  forPercent: number;
  againstPercent: number;
  abstainPercent: number;
}

export interface ActiveVoter {
  address: string;
  participationCount: number;
  votingPower: number;
}

export interface AnalyticsMetrics {
  proposalCount: number;
  overallParticipationRate: number | null;
  passRate: number | null;
  averageVotingPower: number;
  quorumAchievementRate: number | null;
  voteSplit: { for: number; against: number; abstain: number };
  participationTrend: TrendPoint[];
  quorumTrend: TrendPoint[];
  monthlyProposals: MonthlyProposalStats[];
  categorySplits: CategoryVoteSplit[];
  activeVoters: ActiveVoter[];
  voterCount: number;
  giniCoefficient: number | null;
}

export async function getProposalSupplies(proposals: Proposal[]): Promise<Record<string, number>> {
  if (proposals.length === 0) return {};
  if (USE_FIXTURE) {
    return Object.fromEntries(proposals.map(proposal => [proposal.id, FIXTURE_CIRCULATING_SUPPLY]));
  }

  const client = await createQuorumClient({ withToken: true });
  const snapshotLedgers = [...new Set(proposals.map(proposal => proposal.snapshotLedger))];
  const supplies = await Promise.all(snapshotLedgers.map(async ledger => {
    const rawSupply = await client.getPastTotalSupply(ledger);
    if (rawSupply > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`Token supply at snapshot ledger ${ledger} exceeds the supported analytics range`);
    }
    return [ledger, Number(rawSupply)] as const;
  }));
  const suppliesByLedger = new Map(supplies);

  return Object.fromEntries(proposals.map(proposal => [
    proposal.id,
    suppliesByLedger.get(proposal.snapshotLedger) ?? 0,
  ]));
}

export function calculateAnalytics(
  proposals: Proposal[],
  suppliesByProposal: Record<string, number>,
): AnalyticsMetrics {
  const totals = proposals.map(proposal => ({
    proposal,
    totalVotes: proposal.forVotes + proposal.againstVotes + proposal.abstainVotes,
  }));
  const eligible = totals.filter(({ proposal }) => !["pending", "cancelled"].includes(proposal.status));
  const participation = eligible.reduce((result, { proposal, totalVotes }) => {
    const supply = suppliesByProposal[proposal.id];
    if (Number.isFinite(supply) && supply > 0) {
      result.votingPower += totalVotes;
      result.supply += supply;
    }
    return result;
  }, { votingPower: 0, supply: 0 });
  const totalVotingPower = totals.reduce((sum, item) => sum + item.totalVotes, 0);
  const resolved = totals.filter(({ proposal }) =>
    ["passed", "failed", "executed"].includes(proposal.status),
  );
  const quorumEligible = eligible.filter(({ totalVotes }) => totalVotes > 0);
  const reachedQuorum = ({ proposal, totalVotes }: (typeof totals)[number]) =>
    proposal.quorumRequired <= 0 || totalVotes >= proposal.quorumRequired;

  const voteSplit = totals.reduce(
    (split, { proposal }) => ({
      for: split.for + proposal.forVotes,
      against: split.against + proposal.againstVotes,
      abstain: split.abstain + proposal.abstainVotes,
    }),
    { for: 0, against: 0, abstain: 0 },
  );

  const categoryTotals = new Map<string, { for: number; against: number; abstain: number; samples: number }>();
  const voterTotals = new Map<string, { participationCount: number; votingPower: number }>();
  for (const { proposal } of totals) {
    const category = categoryTotals.get(proposal.category) ?? { for: 0, against: 0, abstain: 0, samples: 0 };
    const categoryVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
    if (categoryVotes > 0) {
      category.for += proposal.forVotes / categoryVotes * 100;
      category.against += proposal.againstVotes / categoryVotes * 100;
      category.abstain += proposal.abstainVotes / categoryVotes * 100;
      category.samples += 1;
    }
    categoryTotals.set(proposal.category, category);

    const votersSeen = new Set<string>();
    for (const vote of proposal.votes) {
      const current = voterTotals.get(vote.voter) ?? { participationCount: 0, votingPower: 0 };
      current.votingPower += vote.weight;
      if (!votersSeen.has(vote.voter)) {
        current.participationCount += 1;
        votersSeen.add(vote.voter);
      }
      voterTotals.set(vote.voter, current);
    }
  }

  const dated = [...totals].sort(
    (a, b) => new Date(a.proposal.startTime).getTime() - new Date(b.proposal.startTime).getTime(),
  );
  const participationTrend = dated
    .filter(({ proposal }) =>
      !["pending", "cancelled"].includes(proposal.status) && suppliesByProposal[proposal.id] > 0,
    )
    .slice(-10)
    .map(({ proposal, totalVotes }) => ({
      label: proposal.id,
      value: totalVotes / suppliesByProposal[proposal.id] * 100,
    }));

  const monthMap = new Map<string, {
    passed: number;
    failed: number;
    active: number;
    other: number;
    quorumMet: number;
    quorumCount: number;
  }>();
  for (const { proposal, totalVotes } of totals) {
    const date = new Date(proposal.startTime);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const month = monthMap.get(key) ?? {
      passed: 0, failed: 0, active: 0, other: 0, quorumMet: 0, quorumCount: 0,
    };
    if (["passed", "executed"].includes(proposal.status)) month.passed += 1;
    else if (proposal.status === "failed") month.failed += 1;
    else if (proposal.status === "active") month.active += 1;
    else month.other += 1;
    if (totalVotes > 0) {
      month.quorumCount += 1;
      if (reachedQuorum({ proposal, totalVotes })) month.quorumMet += 1;
    }
    monthMap.set(key, month);
  }

  const monthlyProposals = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, month]) => ({
      label: key,
      passed: month.passed,
      failed: month.failed,
      active: month.active,
      other: month.other,
      quorumRate: month.quorumCount > 0 ? month.quorumMet / month.quorumCount * 100 : null,
    }));

  const voterPowers = [...voterTotals.values()].map(voter => voter.votingPower);
  const sortedPowers = [...voterPowers].sort((a, b) => a - b);
  const powerSum = sortedPowers.reduce((sum, power) => sum + power, 0);
  const giniCoefficient = powerSum > 0
    ? Math.max(0, 2 * sortedPowers.reduce((sum, power, index) => sum + (index + 1) * power, 0)
      / (sortedPowers.length * powerSum) - (sortedPowers.length + 1) / sortedPowers.length)
    : null;

  return {
    proposalCount: proposals.length,
    overallParticipationRate: participation.supply > 0
      ? participation.votingPower / participation.supply * 100
      : null,
    passRate: resolved.length
      ? resolved.filter(({ proposal, totalVotes }) =>
        reachedQuorum({ proposal, totalVotes }) && proposal.forVotes > proposal.againstVotes,
      ).length / resolved.length * 100
      : null,
    averageVotingPower: proposals.length ? totalVotingPower / proposals.length : 0,
    quorumAchievementRate: quorumEligible.length
      ? quorumEligible.filter(reachedQuorum).length / quorumEligible.length * 100
      : null,
    voteSplit,
    participationTrend,
    quorumTrend: monthlyProposals.flatMap(month =>
      month.quorumRate === null ? [] : [{ label: month.label, value: month.quorumRate }],
    ),
    monthlyProposals,
    categorySplits: [...categoryTotals.entries()].flatMap(([category, split]) => {
      return split.samples > 0 ? [{
        category,
        forPercent: split.for / split.samples,
        againstPercent: split.against / split.samples,
        abstainPercent: split.abstain / split.samples,
      }] : [];
    }).sort((a, b) => a.category.localeCompare(b.category)),
    activeVoters: [...voterTotals.entries()]
      .map(([address, voter]) => ({ address, ...voter }))
      .sort((a, b) => b.participationCount - a.participationCount || b.votingPower - a.votingPower)
      .slice(0, 5),
    voterCount: voterTotals.size,
    giniCoefficient,
  };
}
