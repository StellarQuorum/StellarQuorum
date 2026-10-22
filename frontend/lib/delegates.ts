import type { Proposal, VoteChoice } from "@/lib/types";

// Issue #280: the delegate directory. Everything here is a pure function over
// plain data, so the ranking and history rules are tested without the page.

export interface DelegateSummary {
  address: string;
  /** Voting weight delegated to this address, in whole QUORUM. */
  delegatedWeight: number;
  delegatorCount: number;
}

export interface ParticipationEntry {
  proposalId: string;
  title: string;
  choice: VoteChoice;
  weight: number;
  timestamp: string;
}

/**
 * What the directory is waiting on. The contract can answer "who delegated to
 * this address", but the SDK has no method that lists delegates, so there is
 * nothing to rank until that read exists. Kept here so the page and the tests
 * name the same blockers.
 */
export const DELEGATES_BLOCKED_ON = "#1, #47 and #60";

/** Most weight first. Ties fall back to the address, so the order is stable between renders. */
export function rankDelegates(delegates: readonly DelegateSummary[]): DelegateSummary[] {
  return [...delegates].sort(
    (a, b) => b.delegatedWeight - a.delegatedWeight || a.address.localeCompare(b.address),
  );
}

/**
 * Delegates the directory can show. Returns nothing until delegation totals are
 * readable through the SDK (see DELEGATES_BLOCKED_ON), so the page renders its
 * blocked-on note rather than invented numbers.
 */
export async function getDelegates(): Promise<DelegateSummary[]> {
  return [];
}

/** How one address voted on each proposal, most recent vote first. */
export function participationFor(address: string, proposals: readonly Proposal[]): ParticipationEntry[] {
  return proposals
    .flatMap(proposal =>
      proposal.votes
        .filter(vote => vote.voter === address)
        .map(vote => ({
          proposalId: proposal.id,
          title: proposal.title,
          choice: vote.choice,
          weight: vote.weight,
          timestamp: vote.timestamp,
        })),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
