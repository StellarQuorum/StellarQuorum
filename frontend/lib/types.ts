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
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumRequired: number;
  actions: ProposalAction[];
  votes: Vote[];
  category: string;
}
