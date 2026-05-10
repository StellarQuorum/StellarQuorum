export type ProposalStatus =
  | 'Pending' | 'Active' | 'Passed' | 'Failed'
  | 'Queued'  | 'Executed' | 'Cancelled';

export type VoteSupport = 0 | 1 | 2; // 0=Against 1=For 2=Abstain

export interface Proposal {
  id: bigint;
  proposer: string;
  title: string;
  description: string;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  snapshotLedger: number;
  startLedger: number;
  endLedger: number;
  queueLedger: number;
  quorumRequired: bigint;
  status: ProposalStatus;
}

export interface GovernanceConfig {
  token: string;
  quorumBps: number;
  votingPeriod: number;
  timelockPeriod: number;
  proposalThreshold: bigint;
  admin: string;
}

export interface QuorumClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
  governanceContractId: string;
  tokenContractId: string;
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}
