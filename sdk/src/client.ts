import { SorobanRpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, Address } from '@stellar/stellar-sdk';
import type { Proposal, GovernanceConfig, QuorumClientConfig, VoteSupport } from './types';

export class QuorumClient {
  private server: SorobanRpc.Server;
  private governance: Contract;
  private config: QuorumClientConfig;

  constructor(config: QuorumClientConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.governance = new Contract(config.governanceContractId);
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  async getProposal(id: bigint): Promise<Proposal | null> {
    // TODO: implement via simulateTransaction → governance.get_proposal(id)
    throw new Error('Not implemented');
  }

  async getProposalCount(): Promise<bigint> {
    // TODO: implement via simulateTransaction → governance.get_proposal_count()
    throw new Error('Not implemented');
  }

  async getConfig(): Promise<GovernanceConfig> {
    // TODO: implement via simulateTransaction → governance.get_config()
    throw new Error('Not implemented');
  }

  async hasVoted(proposalId: bigint, voter: string): Promise<boolean> {
    // TODO: implement via simulateTransaction → governance.has_voted(proposalId, voter)
    throw new Error('Not implemented');
  }

  async getAllProposals(): Promise<Proposal[]> {
    const count = await this.getProposalCount();
    const proposals = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) => this.getProposal(BigInt(i + 1)))
    );
    return proposals.filter(Boolean) as Proposal[];
  }

  // ─── Transaction Builders ────────────────────────────────────────────────
  // These return unsigned XDR strings — the caller signs with Freighter and submits.

  async buildCreateProposal(proposer: string, title: string, description: string): Promise<string> {
    // TODO: build transaction → governance.create_proposal(proposer, title, description)
    throw new Error('Not implemented');
  }

  async buildVote(voter: string, proposalId: bigint, support: VoteSupport): Promise<string> {
    // TODO: build transaction → governance.vote(voter, proposalId, support)
    throw new Error('Not implemented');
  }

  async buildFinalize(proposalId: bigint): Promise<string> {
    // TODO: build transaction → governance.finalize(proposalId)
    throw new Error('Not implemented');
  }

  async buildExecute(proposalId: bigint): Promise<string> {
    // TODO: build transaction → governance.execute(proposalId)
    throw new Error('Not implemented');
  }
}

export const TESTNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

export const MAINNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-rpc.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
};
