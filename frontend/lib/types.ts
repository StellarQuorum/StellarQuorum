export type ProposalStatus = 'active' | 'passed' | 'failed' | 'pending' | 'executed' | 'cancelled';
export type VoteChoice = 'for' | 'against' | 'abstain';

export interface Vote {
  voter: string;
  choice: VoteChoice;
  weight: number;
  timestamp: string;
}

export interface ProposalAction {
  description: string;
  contractAddress: string;
  functionName: string;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  status: ProposalStatus;
  startTime: string;
  endTime: string;
  /**
   * Ledger the proposal snapshotted token balances at, set when it was created.
   * A vote's weight is the voter's balance here, not their current balance.
   */
  snapshotLedger: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumRequired: number;
  actions: ProposalAction[];
  votes: Vote[];
  category: string;
}
