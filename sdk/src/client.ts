import { SorobanRpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, Address, Account, xdr } from '@stellar/stellar-sdk';
import type { Proposal, GovernanceConfig, QuorumClientConfig, VoteSupport } from './types.js';
import { GovernanceError, parseGovernanceError } from './errors.js';

/**
 * Source account used for read-only simulation.
 *
 * Simulating a contract call still requires a source account to build the
 * transaction, but a simulation is never signed or submitted, so the all-zero
 * ed25519 account works and means reads need no funded account.
 */
const READ_ONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

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

  /** A proposal by id, or `null` if the contract reports ProposalNotFound. */
  async getProposal(id: bigint): Promise<Proposal | null> {
    try {
      const raw = await this.simulate<RawProposal>('get_proposal', nativeToScVal(id, { type: 'u64' }));
      return decodeProposal(raw);
    } catch (error) {
      if (parseGovernanceError(error) === GovernanceError.ProposalNotFound) return null;
      throw error;
    }
  }

  async getProposalCount(): Promise<bigint> {
    return BigInt(await this.simulate<bigint | number>('get_proposal_count'));
  }

  async getConfig(): Promise<GovernanceConfig> {
    const raw = await this.simulate<RawConfig>('get_config');
    return {
      token: raw.token,
      quorumBps: raw.quorum_bps,
      votingPeriod: raw.voting_period,
      timelockPeriod: raw.timelock_period,
      proposalThreshold: raw.proposal_threshold,
      admin: raw.admin,
    };
  }

  async hasVoted(proposalId: bigint, voter: string): Promise<boolean> {
    // has_voted and get_vote read the same storage entry, so one round trip
    // answers both questions.
    return (await this.getVote(proposalId, voter)) !== null;
  }

  /**
   * The choice a voter recorded on a proposal, or `null` if they have not
   * voted.
   *
   * @param proposalId Proposal to look up.
   * @param voter Stellar address of the voter.
   * @returns `0` Against, `1` For, `2` Abstain, or `null`.
   */
  async getVote(proposalId: bigint, voter: string): Promise<VoteSupport | null> {
    const support = await this.simulate<number | null | undefined>(
      'get_vote',
      nativeToScVal(proposalId, { type: 'u64' }),
      new Address(voter).toScVal(),
    );
    // The contract returns Option<u32>; None decodes to null/undefined.
    return support === null || support === undefined ? null : (support as VoteSupport);
  }

  /** Sequence of the latest closed ledger, for turning proposal ledgers into times. */
  async getLatestLedger(): Promise<number> {
    return (await this.server.getLatestLedger()).sequence;
  }

  async getProposalsByStatus(status: Proposal['status']): Promise<Proposal[]> {
    const all = await this.getAllProposals();
    return all.filter(p => p.status === status);
  }

  async getAllProposals(): Promise<Proposal[]> {
    const count = await this.getProposalCount();
    const proposals = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) => this.getProposal(BigInt(i + 1)))
    );
    return proposals.filter(Boolean) as Proposal[];
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Calls a read-only contract method through `simulateTransaction` and decodes
   * the return value.
   *
   * Nothing is signed or submitted, so this costs no fee and needs no funded
   * account.
   */
  private async simulate<T>(method: string, ...args: xdr.ScVal[]): Promise<T> {
    const source = new Account(READ_ONLY_SOURCE, '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.governance.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation of ${method} failed: ${simulation.error}`);
    }
    if (!simulation.result) {
      throw new Error(`Simulation of ${method} returned no result`);
    }

    return scValToNative(simulation.result.retval) as T;
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

// ─── Decoding ──────────────────────────────────────────────────────────────
// scValToNative output for the contract's #[contracttype] structs: field names
// stay snake_case, i128/u64 become bigint, u32 becomes number, Address becomes
// a strkey string, and a unit enum variant becomes a one-element [name] array.

interface RawProposal {
  id: bigint;
  proposer: string;
  title: string;
  description: string;
  for_votes: bigint;
  against_votes: bigint;
  abstain_votes: bigint;
  snapshot_ledger: number;
  start_ledger: number;
  end_ledger: number;
  queue_ledger: number;
  quorum_required: bigint;
  status: [Proposal['status']];
}

interface RawConfig {
  token: string;
  quorum_bps: number;
  voting_period: number;
  timelock_period: number;
  proposal_threshold: bigint;
  admin: string;
}

function decodeProposal(raw: RawProposal): Proposal {
  return {
    id: raw.id,
    proposer: raw.proposer,
    title: raw.title,
    description: raw.description,
    forVotes: raw.for_votes,
    againstVotes: raw.against_votes,
    abstainVotes: raw.abstain_votes,
    snapshotLedger: raw.snapshot_ledger,
    startLedger: raw.start_ledger,
    endLedger: raw.end_ledger,
    queueLedger: raw.queue_ledger,
    quorumRequired: raw.quorum_required,
    status: raw.status[0],
  };
}

export const TESTNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

export const MAINNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-rpc.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
};
