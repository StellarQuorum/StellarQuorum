/** Statuses stored directly on-chain by the governance contract. */
export type ProposalStatus =
  | 'Active' | 'Failed' | 'Queued' | 'Executed' | 'Cancelled'
  | 'Expired' | 'Vetoed';

/**
 * Derived client-side phases computed from on-chain status + ledger timing.
 * Not stored on-chain; use these in UI display logic only.
 */
export type ProposalPhase = 'Pending' | 'Voting' | 'TimelockPending' | ProposalStatus;

export type VoteSupport = 0 | 1 | 2; // 0=Against 1=For 2=Abstain

export type ProposalKind = 'Standard' | 'Upgrade';

/** On-chain action attached to an executable proposal. */
export interface ProposalAction {
  targetContractId: string;
  functionName: string;
  args: unknown[];
}

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
  /** Ledger sequence at which the timelock expires and execution is allowed. */
  timelockPeriod: number;
  /** Ledger sequence after queue_ledger by which execution must occur. */
  executionGracePeriod: number;
  /** Optional IPFS or HTTPS URI for extended proposal metadata. */
  metadataUri?: string;
  /** Whether this is a standard governance call or a contract upgrade. */
  kind: ProposalKind;
}

export interface ConvictionTally {
  forConviction: bigint;
  againstConviction: bigint;
  updatedLedger: number;
}

export interface GovernanceConfig {
  token: string;
  quorumBps: number;
  votingPeriod: number;
  timelockPeriod: number;
  proposalThreshold: bigint;
  admin: string;
  /** Address allowed to veto proposals before execution. */
  guardian: string;
  /** Seconds after timelock expiry during which execution is still permitted. */
  executionGracePeriod: number;
  /** Whether the governance contract is currently paused. */
  paused: boolean;
  /** Token amount the proposer must lock when submitting a proposal. */
  proposalDeposit: bigint;
  /** Minimum seconds a proposer must wait before submitting another proposal. */
  proposerCooldown: number;
}

/** Deployed contract versions reported by each contract's `version()` method. */
export interface ContractVersions {
  governance: string;
  token: string;
}

export interface QuorumClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
  governanceContractId: string;
  tokenContractId?: string;
  requestTimeoutMs?: number;
  readRetryAttempts?: number;
  retryBaseDelayMs?: number;
  retryJitterMs?: number;
  pollIntervalMs?: number;
  confirmationTimeoutMs?: number;
  /** Read caching is off unless cache.enabled is true. TTLs are milliseconds. */
  cache?: ReadCacheConfig;
  /** Opt in to JSON-RPC batch simulations for concurrent proposal reads. */
  batchSimulation?: boolean;
  /** Transactions per batch, 1..100 (default 50). */
  simulationBatchSize?: number;
}

export type ReadMethod =
  | 'getProposal' | 'getProposalCount' | 'getConfig' | 'getVote'
  | 'getLatestLedger' | 'getVotingPower' | 'getBalance' | 'getTokenDecimals'
  | 'balance' | 'getPastBalance' | 'allowance' | 'totalSupply'
  | 'getProposalsByProposer' | 'getPastTotalSupply'
  | 'getCosponsors' | 'getConviction' | 'lockedBalance' | 'spendableBalance'
  | 'getGovernanceStats';

export interface ReadCacheConfig {
  enabled: boolean;
  /** Default 5 seconds; zero disables caching for a method. */
  ttlMs?: number;
  methodTtlMs?: Partial<Record<ReadMethod, number>>;
  /** Maximum entries retained per client, default 1000. */
  maxEntries?: number;
}

export interface ReadOptions {
  /** Fetch fresh data without reading or populating the cache. */
  bypassCache?: boolean;
  /** Evict this method + arguments before fetching and caching fresh data. */
  invalidateCache?: boolean;
}

export interface TransactionConfirmationOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Polling options for `waitForProposalStatus` (issue #274). */
export interface WaitForStatusOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Fee breakdown for a built transaction, in stroops (issue #277).
 *
 * `totalFee` is what the network charges if the transaction is submitted at
 * current pricing: show it before the signing prompt.
 */
export interface FeeEstimate {
  /** Classic inclusion fee, excluding any Soroban resource fee. */
  inclusionFee: bigint;
  /** Soroban resource fee for the simulated footprint at current pricing. */
  resourceFee: bigint;
  /** `inclusionFee + resourceFee`. */
  totalFee: bigint;
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Pagination window for proposal listing (issue #118).
 *
 * `offset` is the number of oldest proposals to skip (0-based), `limit` is
 * the maximum number of proposals to return. When omitted, callers that pass
 * no options get the historical behaviour (all proposals).
 */
export interface GetProposalsOptions extends ReadOptions {
  limit?: number;
  offset?: number;
}

/** Aggregate governance statistics returned by `getGovernanceStats()`. */
export interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  queuedProposals: number;
  executedProposals: number;
  failedProposals: number;
  cancelledProposals: number;
  expiredProposals: number;
  vetoedProposals: number;
}
