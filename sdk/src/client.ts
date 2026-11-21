import { rpc, Contract, Transaction, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, Address, Account, xdr } from '@stellar/stellar-sdk';
import type { Proposal, ConvictionTally, ContractVersions, GovernanceConfig, GovernanceStats, QuorumClientConfig, VoteSupport, GetProposalsOptions, ProposalStatus, TransactionConfirmationOptions, WaitForStatusOptions, FeeEstimate, ReadMethod, ReadOptions } from './types.js';
import { ReadCache } from './cache.js';
import { SimulationBatcher, postSimulationBatch } from './batch.js';
import { GovernanceContractError, GOVERNANCE_ERROR_MESSAGES, GovernanceError, governanceErrorFromCode, parseGovernanceError, RpcTimeoutError, TransactionFailedError, contractErrorCode } from './errors.js';
import { decodeEvent } from './events.js';
import type { DelegatedEvent, ProposalVetoedEvent } from './events.js';

/**
 * Source account used for read-only simulation.
 *
 * Simulating a contract call still requires a source account to build the
 * transaction, but a simulation is never signed or submitted, so the all-zero
 * ed25519 account works and means reads need no funded account.
 */
const READ_ONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Whether a plain-HTTP RPC URL may be used.
 *
 * The stellar-sdk refuses insecure URLs unless `allowHttp` is set; allow
 * them only for loopback hosts (local nodes, the test mock RPC) so every
 * remote endpoint keeps the SDK's HTTPS requirement.
 */
function allowsInsecureRpc(rpcUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rpcUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Default page size for paginated proposal listing (issue #118).
 *
 * Matches the recommendation in `docs/proposal-list-performance.md`: 50 cards
 * is one screenful, ~200 KiB per page at 4 KiB/proposal stays under public
 * RPC response caps, with diminishing returns above 50.
 */
export const DEFAULT_PAGE_SIZE = 50;
const MAX_PROPOSALS_PER_CALL = 100;
const MAX_STATUS_SCAN_PAGES = 20;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_READ_RETRY_ATTEMPTS = 2;
export const DEFAULT_RETRY_BASE_DELAY_MS = 100;
export const DEFAULT_RETRY_JITTER_MS = 50;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;

/** SDK 0.2.x is built against the 0.1.x governance and token ABIs. */
export const SUPPORTED_CONTRACT_VERSION_RANGE = '>=0.1.0 <0.2.0';

function isSupportedContractVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match) return false;
  const [, major, minor] = match;
  return Number(major) === 0 && Number(minor) === 1;
}

// ─── Typed governance errors (issue #115) ────────────────────────────────────
// The contract surfaces failures as `GovernanceError` codes; a simulation
// failure string looks like `... Error(Contract, #12) ...`. These map the
// timelock / status paths to typed errors so callers can branch on them
// instead of parsing strings.

export class ProposalNotFoundError extends Error {
  readonly code = GovernanceError.ProposalNotFound;

  constructor(proposalId?: bigint | string, message?: string) {
    super(message ?? `Proposal not found${proposalId !== undefined ? `: ${String(proposalId)}` : ''}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class VotingNotActiveError extends Error {
  readonly code = GovernanceError.VotingNotActive;

  constructor(message = 'Voting window is still open; proposal cannot be finalized yet') {
    super(message);
    this.name = 'VotingNotActiveError';
  }
}

export class ProposalNotPassedError extends Error {
  readonly code = GovernanceError.ProposalNotPassed;

  constructor(message = 'Proposal is not queued and cannot be executed') {
    super(message);
    this.name = 'ProposalNotPassedError';
  }
}

export class TimelockNotExpiredError extends Error {
  readonly code = GovernanceError.TimelockNotExpired;

  constructor(message = 'Timelock has not expired; proposal cannot be executed yet') {
    super(message);
    this.name = 'TimelockNotExpiredError';
  }
}

export class UnauthorizedError extends Error {
  readonly code = GovernanceError.Unauthorized;

  constructor(message = 'Caller is not authorized for this action') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * `waitForProposalStatus` stopped polling before the proposal reached the
 * target status (issue #274). `lastStatus` is the status seen on the final poll.
 */
export class ProposalStatusTimeoutError extends Error {
  readonly proposalId: bigint;
  readonly targetStatus: ProposalStatus;
  readonly lastStatus: ProposalStatus;

  constructor(proposalId: bigint, targetStatus: ProposalStatus, lastStatus: ProposalStatus, timeoutMs: number) {
    super(`Proposal ${String(proposalId)} did not reach ${targetStatus} within ${timeoutMs}ms (last status: ${lastStatus})`);
    this.name = 'ProposalStatusTimeoutError';
    this.proposalId = proposalId;
    this.targetStatus = targetStatus;
    this.lastStatus = lastStatus;
  }
}

export function mapGovernanceSimulationError(method: string, raw: unknown): Error {
  const message = raw instanceof Error ? raw.message : String(raw);
  const code = contractErrorCode(message);
  const namedCode = Object.entries(GovernanceError).find(([name, value]) =>
    typeof value === 'number' && message.includes(name),
  )?.[1];
  const governanceCode = code === undefined ? namedCode as GovernanceError | undefined : governanceErrorFromCode(code);
  if (governanceCode === undefined) return new Error(`Simulation of ${method} failed: ${message}`);

  const detail = `Simulation of ${method} failed: ${GOVERNANCE_ERROR_MESSAGES[governanceCode]} (${message})`;
  switch (governanceCode) {
    case GovernanceError.ProposalNotFound: return new ProposalNotFoundError(undefined, detail);
    case GovernanceError.VotingNotActive: return new VotingNotActiveError(detail);
    case GovernanceError.ProposalNotPassed: return new ProposalNotPassedError(detail);
    case GovernanceError.TimelockNotExpired: return new TimelockNotExpiredError(detail);
    case GovernanceError.Unauthorized: return new UnauthorizedError(detail);
    default: return new GovernanceContractError(governanceCode, detail);
  }
}

export class QuorumClient {
  private server: rpc.Server;
  private governance: Contract;
  private token: Contract | null;
  private config: QuorumClientConfig;
  private readonly cache: ReadCache;
  private readonly batcher?: SimulationBatcher;
  private getProposalsSupported: boolean | undefined;

  constructor(config: QuorumClientConfig) {
    this.config = config;
    this.cache = new ReadCache(config.cache);
    if (config.batchSimulation) {
      this.batcher = new SimulationBatcher(
        transactions => this.read('batch simulate', () => postSimulationBatch(
          config.rpcUrl, transactions, config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        )),
        config.simulationBatchSize ?? DEFAULT_PAGE_SIZE,
      );
    }
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: allowsInsecureRpc(config.rpcUrl),
      timeout: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    this.governance = new Contract(config.governanceContractId);
    // tokenContractId is required by the config type but older callers
    // (e.g. bench RPC mode) only pass a governance id — stay usable and fail
    // with a clear message only when a token method is actually used.
    this.token = config.tokenContractId ? new Contract(config.tokenContractId) : null;
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  /** Evict all reads, one method, or one method + arguments. */
  invalidateCache(method?: ReadMethod, ...args: unknown[]): void {
    this.cache.invalidate(method, args.length ? args : undefined);
  }

  /** A proposal by id, or `null` if the contract reports ProposalNotFound. */
  async getProposal(id: bigint, options?: ReadOptions): Promise<Proposal | null> {
    return this.cache.read('getProposal', [id], options, async () => {
      try {
        const raw = await this.simulate<RawProposal>('get_proposal', nativeToScVal(id, { type: 'u64' }));
        return decodeProposal(raw);
      } catch (error) {
        if (parseGovernanceError(error) === GovernanceError.ProposalNotFound) return null;
        throw error;
      }
    });
  }

  /**
   * Returns the on-chain veto event for a vetoed proposal, including its
   * guardian and required reason. The event is searched only over that
   * proposal's timelock window, using Soroban RPC's event filters.
   */
  async getProposalVetoEvent(id: bigint): Promise<ProposalVetoedEvent | null> {
    const proposal = await this.getProposal(id);
    if (!proposal || proposal.status !== 'Vetoed' || proposal.queueLedger === 0) return null;

    const startLedger = Math.max(1, proposal.queueLedger - proposal.timelockPeriod);
    const endLedger = proposal.queueLedger - 1;
    if (startLedger > endLedger) return null;

    const topic = nativeToScVal('proposal_vetoed', { type: 'symbol' }).toXDR('base64');
    const proposalTopic = nativeToScVal(id, { type: 'u64' }).toXDR('base64');
    const response = await this.read('getProposalVetoEvent', () => this.server.getEvents({
      startLedger,
      endLedger,
      limit: 100,
      filters: [{
        type: 'contract',
        contractIds: [this.config.governanceContractId],
        topics: [[topic, proposalTopic]],
      }],
    }));

    for (const event of response.events) {
      const decoded = decodeEvent(event);
      if (decoded?.type === 'proposal_vetoed' && decoded.id === id) return decoded;
    }
    return null;
  }

  /** Recent on-chain delegation changes for an address (Soroban's retained event window). */
  async getDelegationEvents(address: string): Promise<Array<DelegatedEvent & { ledger: number }>> {
    const latestLedger = await this.getLatestLedger();
    const startLedger = Math.max(1, latestLedger - 120_960);
    const topic = nativeToScVal('delegated', { type: 'symbol' }).toXDR('base64');
    const delegatorTopic = new Address(address).toScVal().toXDR('base64');
    const response = await this.read('getDelegationEvents', () => this.server.getEvents({
      startLedger,
      endLedger: latestLedger,
      limit: 1000,
      filters: [{ type: 'contract', contractIds: [this.config.governanceContractId], topics: [[topic, delegatorTopic]] }],
    }));
    const events: Array<DelegatedEvent & { ledger: number }> = [];
    for (const event of response.events) {
      const decoded = decodeEvent(event);
      if (decoded?.type === 'delegated' && decoded.delegator === address) {
        events.push({ ...decoded, ledger: Number(event.ledger) });
      }
    }
    return events.sort((a, b) => b.ledger - a.ledger);
  }

  async getProposalCount(options?: ReadOptions): Promise<bigint> {
    return this.cache.read('getProposalCount', [], options, async () =>
      BigInt(await this.simulate<bigint | number>('get_proposal_count')));
  }

  async getLatestLedger(options?: ReadOptions): Promise<number> {
    return this.cache.read('getLatestLedger', [], options, async () =>
      (await this.read('getLatestLedger', () => this.server.getLatestLedger())).sequence);
  }

  async getVotingPower(voter: string, snapshotLedger: number, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('getVotingPower', [voter, snapshotLedger], options, async () => {
      const token = await this.tokenContract(options);
      return BigInt(await this.simulateOn<bigint | number>(token, 'get_past_votes', new Address(voter).toScVal(), nativeToScVal(snapshotLedger, { type: 'u32' })));
    });
  }

  /** Current representative, including delegations made directly on the token. */
  async getDelegate(holder: string): Promise<string> {
    return this.simulate<string>('get_delegate', new Address(holder).toScVal());
  }

  async getBalance(voter: string, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('getBalance', [voter], options, async () => {
      const token = await this.tokenContract(options);
      return BigInt(await this.simulateOn<bigint | number>(token, 'balance', new Address(voter).toScVal()));
    });
  }

  async getTokenDecimals(options?: ReadOptions): Promise<number> {
    return this.cache.read('getTokenDecimals', [], options, async () => {
      const token = await this.tokenContract(options);
      return this.simulateOn<number>(token, 'decimals');
    });
  }

  async getConfig(options?: ReadOptions): Promise<GovernanceConfig> {
    return this.cache.read('getConfig', [], options, async () => {
      const raw = await this.simulate<RawConfig>('get_config');
      return {
        token: raw.token,
        quorumBps: raw.quorum_bps,
        votingPeriod: raw.voting_period,
        timelockPeriod: raw.timelock_period,
        proposalThreshold: raw.proposal_threshold,
        admin: raw.admin,
        guardian: raw.guardian ?? '',
        executionGracePeriod: raw.execution_grace_period ?? 0,
        paused: raw.paused ?? false,
        proposalDeposit: raw.proposal_deposit ?? BigInt(0),
        proposerCooldown: raw.proposer_cooldown ?? 0,
      };
    });
  }

  /**
   * Reads both deployed contract versions and warns when either falls outside
   * the ABI range supported by this SDK release. Call during application
   * startup so a contract/SDK mismatch is visible before users submit a call.
   */
  async getContractVersions(): Promise<ContractVersions> {
    const [governance, config] = await Promise.all([
      this.simulate<string>('version'),
      this.getConfig({ bypassCache: true }),
    ]);
    const token = await this.simulateOn<string>(new Contract(config.token), 'version');
    const versions = { governance, token };
    for (const [contract, version] of Object.entries(versions)) {
      if (!isSupportedContractVersion(version)) {
        console.warn(
          `Quorum SDK supports contract versions ${SUPPORTED_CONTRACT_VERSION_RANGE}; ` +
          `${contract} contract reports ${version}. Upgrade the SDK or deploy a supported contract version.`,
        );
      }
    }
    return versions;
  }

  async hasVoted(proposalId: bigint, voter: string, options?: ReadOptions): Promise<boolean> {
    // has_voted and get_vote read the same storage entry, so one round trip
    // answers both questions.
    return (await this.getVote(proposalId, voter, options)) !== null;
  }

  /**
   * The choice a voter recorded on a proposal, or `null` if they have not
   * voted.
   *
   * @param proposalId Proposal to look up.
   * @param voter Stellar address of the voter.
   * @returns `0` Against, `1` For, `2` Abstain, or `null`.
   */
  async getVote(proposalId: bigint, voter: string, options?: ReadOptions): Promise<VoteSupport | null> {
    return this.cache.read('getVote', [proposalId, voter], options, async () => {
      const support = await this.simulate<number | null | undefined>(
        'get_vote',
        nativeToScVal(proposalId, { type: 'u64' }),
        new Address(voter).toScVal(),
      );
      // The contract returns Option<u32>; None decodes to null/undefined.
      return support === null || support === undefined ? null : (support as VoteSupport);
    });
  }

  /**
   * Lists proposals matching `status` (issue #462).
   *
   * When `options.limit` is provided, pages through proposals until `limit`
   * matching proposals are found or all proposals are exhausted (capped at
   * `MAX_STATUS_SCAN_PAGES` pages).
   */
  async getProposalsByStatus(status: Proposal['status'], options?: GetProposalsOptions): Promise<Proposal[]> {
    const limit = options?.limit;
    if (limit === undefined) {
      const all = await this.getAllProposals(options);
      return all.filter(p => p.status === status);
    }
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(`Invalid limit ${String(limit)}: must be a non-negative integer`);
    }
    if (limit === 0) return [];

    let cursorOffset = options?.offset ?? 0;
    const matches: Proposal[] = [];
    for (let pageIndex = 0; pageIndex < MAX_STATUS_SCAN_PAGES; pageIndex += 1) {
      const page = await this.fetchProposalWindow(cursorOffset, MAX_PROPOSALS_PER_CALL, options);
      for (const proposal of page) {
        if (proposal.status === status) {
          matches.push(proposal);
          if (matches.length >= limit) {
            return matches.slice(0, limit);
          }
        }
      }
      if (page.length < MAX_PROPOSALS_PER_CALL) break;
      cursorOffset += page.length;
    }
    return matches;
  }

  /**
   * Paginated proposal listing (issue #118).
   *
   * Fetches only the requested window instead of the whole list, so a list
   * screen rendering one page costs `1 + min(limit, remaining)` RPC calls
   * rather than `1 + N`. Defaults to the first `DEFAULT_PAGE_SIZE` proposals.
   *
   * Once the contract exposes a single-call paginated read
   * (`get_proposals(start, count)` or equivalent), this is the method that
   * should switch to it so listing N proposals costs `O(N / page)` calls;
   * until then it fans out one `getProposal()` per id *within the window*.
   *
   * @param options.limit max proposals to return (default {@link DEFAULT_PAGE_SIZE}).
   * @param options.offset number of oldest proposals to skip (default 0).
   */
  async getProposals(options?: GetProposalsOptions): Promise<Proposal[]> {
    const limit = options?.limit ?? DEFAULT_PAGE_SIZE;
    const offset = options?.offset ?? 0;
    return this.fetchProposalWindow(offset, limit, options);
  }

  /**
   * All proposals, or a single window when `limit`/`offset` are given
   * (issue #118).
   *
   * Without options this keeps the historical behaviour (fetch everything).
   * Pass `{ limit, offset }` to fetch one page: proposal ids are 1-based, so
   * `offset: 0, limit: 50` returns ids 1..50.
   */
  async getAllProposals(options?: GetProposalsOptions): Promise<Proposal[]> {
    return this.fetchProposalWindow(options?.offset ?? 0, options?.limit, options);
  }

  private async fetchProposalWindow(offset: number, limit: number | undefined, options?: ReadOptions): Promise<Proposal[]> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Invalid offset ${String(offset)}: must be a non-negative integer`);
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error(`Invalid limit ${String(limit)}: must be a non-negative integer`);
    }
    if (limit === 0) {
      return [];
    }

    // Issue #450: prefer the contract's single-call `get_proposals(start, limit)`
    // view (1-based start, max 100 per call), falling back to per-id reads only
    // for older deployments without `get_proposals`.
    if (this.getProposalsSupported !== false) {
      try {
        const results: Proposal[] = [];
        let nextStart = offset + 1;
        while (limit === undefined || results.length < limit) {
          const remaining = limit === undefined ? MAX_PROPOSALS_PER_CALL : limit - results.length;
          const chunkLimit = Math.min(MAX_PROPOSALS_PER_CALL, remaining);
          const raw = await this.simulate<RawProposal[]>(
            'get_proposals',
            nativeToScVal(BigInt(nextStart), { type: 'u64' }),
            nativeToScVal(chunkLimit, { type: 'u32' }),
          );
          const decoded = raw.map(decodeProposal);
          this.getProposalsSupported = true;
          results.push(...decoded);
          if (decoded.length < chunkLimit) break;
          nextStart += chunkLimit;
        }
        return results;
      } catch {
        this.getProposalsSupported = false;
      }
    }

    const count = await this.getProposalCount(options);
    const total = Number(count);
    if (offset >= total) {
      return [];
    }
    const end = limit === undefined ? total : Math.min(total, offset + limit);
    const ids: bigint[] = [];
    // Proposal ids are 1-based; offset 0 → id 1.
    for (let id = offset + 1; id <= end; id += 1) {
      ids.push(BigInt(id));
    }
    const proposals = await Promise.all(ids.map(id => this.getProposal(id, options)));
    return proposals.filter(Boolean) as Proposal[];
  }

  /**
   * Every proposal created by `proposer`, oldest first.
   *
   * The contract view takes no pagination arguments: it reads the proposer's
   * index and returns the full list in one simulation, so no offset or limit
   * is offered here. Proposals missing from storage are skipped on-chain.
   *
   * @param proposer Stellar address of the proposer.
   */
  async getProposalsByProposer(proposer: string, options?: ReadOptions): Promise<Proposal[]> {
    return this.cache.read('getProposalsByProposer', [proposer], options, async () => {
      const raw = await this.simulate<RawProposal[]>('get_proposals_by_proposer', new Address(proposer).toScVal());
      return raw.map(decodeProposal);
    });
  }

  /**
   * Returns the co-sponsor addresses for `proposalId` (issue #451).
   *
   * @param proposalId Proposal id.
   * @example
   * const cosponsors = await client.getCosponsors(7n);
   */
  async getCosponsors(proposalId: bigint, options?: ReadOptions): Promise<string[]> {
    return this.cache.read('getCosponsors', [proposalId], options, async () => {
      const raw = await this.simulate<string[]>('get_cosponsors', nativeToScVal(proposalId, { type: 'u64' }));
      return raw ?? [];
    });
  }

  /**
   * Returns the decayed conviction tally for `proposalId`, or `null` for a
   * standard (non-conviction) proposal (issue #451).
   *
   * @param proposalId Proposal id.
   * @example
   * const conviction = await client.getConviction(7n);
   * if (conviction) console.log(conviction.forConviction, conviction.againstConviction);
   */
  async getConviction(proposalId: bigint, options?: ReadOptions): Promise<ConvictionTally | null> {
    return this.cache.read('getConviction', [proposalId], options, async () => {
      const raw = await this.simulate<RawConvictionTally | null | undefined>(
        'get_conviction',
        nativeToScVal(proposalId, { type: 'u64' }),
      );
      return raw ? decodeConvictionTally(raw) : null;
    });
  }

  // ─── Token reads (issue #117) ────────────────────────────────────────────
  // All reads go through the same `simulateTransaction` path as governance
  // reads — nothing is signed or submitted, so they cost no fee.

  private requireToken(): Contract {
    if (!this.token) {
      throw new Error('tokenContractId is not configured; cannot call token methods');
    }
    return this.token;
  }

  /**
   * Live QUORUM balance of `owner`.
   */
  async balance(owner: string, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('balance', [owner], options, () => this.simulateToken<bigint>(
      'balance',
      new Address(owner).toScVal(),
    ));
  }

  /**
   * Raw balance of `owner` as of the end of `ledger`, excluding delegation.
   * Use `getVotingPower` for the effective weight at a proposal snapshot.
   */
  async getPastBalance(owner: string, ledger: number, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('getPastBalance', [owner, ledger], options, () => this.simulateToken<bigint>(
      'get_past_balance',
      new Address(owner).toScVal(),
      nativeToScVal(ledger, { type: 'u32' }),
    ));
  }

  /**
   * Amount `spender` may still draw from `owner` (0 once expired).
   */
  async allowance(owner: string, spender: string, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('allowance', [owner, spender], options, () => this.simulateToken<bigint>(
      'allowance',
      new Address(owner).toScVal(),
      new Address(spender).toScVal(),
    ));
  }

  /**
   * Total QUORUM supply.
   */
  async totalSupply(options?: ReadOptions): Promise<bigint> {
    return this.cache.read('totalSupply', [], options, () => this.simulateToken<bigint>('total_supply'));
  }

  /**
   * Total QUORUM supply as of the end of `ledger`.
   *
   * Supply history is never pruned, so this answers for closed proposals too.
   * Returns 0 for a ledger before the token was initialized.
   */
  async getPastTotalSupply(ledger: number, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('getPastTotalSupply', [ledger], options, () => this.simulateToken<bigint>(
      'get_past_total_supply',
      nativeToScVal(ledger, { type: 'u32' }),
    ));
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * The token contract, resolved on first use.
   *
   * `tokenContractId` is the deployment-time hint. When it is absent the
   * governance config is the authority, so a caller that only knows the
   * governance contract still gets correct balances.
   */
  private async tokenContract(options?: ReadOptions): Promise<Contract> {
    if (this.config.tokenContractId) {
      return new Contract(this.config.tokenContractId);
    }
    const { token } = await this.getConfig(options);
    return new Contract(token);
  }

  /**
   * Calls a read-only contract method through `simulateTransaction` and decodes
   * the return value.
   *
   * Nothing is signed or submitted, so this costs no fee and needs no funded
   * account.
   */
  private async simulate<T>(method: string, ...args: xdr.ScVal[]): Promise<T> {
    return this.simulateOn<T>(this.governance, method, ...args);
  }

  private async simulateToken<T>(method: string, ...args: xdr.ScVal[]): Promise<T> {
    return this.simulateOn<T>(this.requireToken(), method, ...args);
  }

  private async simulateOn<T>(contract: Contract, method: string, ...args: xdr.ScVal[]): Promise<T> {
    return this.simulateWith<T>(contract, method, ...args);
  }

  private async simulateWith<T>(contract: Contract, method: string, ...args: xdr.ScVal[]): Promise<T> {
    const source = new Account(READ_ONLY_SOURCE, '0');
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const request = async (): Promise<T> => {
      const simulation = await this.read(`simulate:${method}`, () => this.server.simulateTransaction(tx));
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation of ${method} failed: ${simulation.error}`);
      }
      if (!simulation.result) {
        throw new Error(`Simulation of ${method} returned no result`);
      }
      return scValToNative(simulation.result.retval) as T;
    };
    if (this.batcher && contract === this.governance && method === 'get_proposal') {
      return this.batcher.enqueue(tx.toXDR(), request);
    }
    return request();
  }

  private async read<T>(operation: string, request: () => Promise<T>): Promise<T> {
    const attempts = (this.config.readRetryAttempts ?? DEFAULT_READ_RETRY_ATTEMPTS) + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.withTimeout(operation, request());
      } catch (error) {
        lastError = isTimeoutError(error)
          ? new RpcTimeoutError(operation, this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
          : error;
        if (lastError instanceof RpcTimeoutError || !isTransientRpcError(error) || attempt === attempts - 1) throw lastError;
        const base = this.config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
        const jitter = this.config.retryJitterMs ?? DEFAULT_RETRY_JITTER_MS;
        // Issue #333: false positive. This Math.random only spreads out retry
        // timing so concurrent clients do not synchronize; it never generates
        // a key, nonce or token, so the quality of the randomness is
        // irrelevant to security. See docs/static-analysis.md.
        await delay(base * 2 ** attempt + Math.floor(Math.random() * (jitter + 1))); // nosemgrep
      }
    }
    throw lastError;
  }

  private async withTimeout<T>(operation: string, promise: Promise<T>): Promise<T> {
    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RpcTimeoutError(operation, timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Submit already-signed XDR once, then poll until the network confirms it. */
  async submitAndWait(signedXdr: string, options?: TransactionConfirmationOptions): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const transaction = TransactionBuilder.fromXDR(signedXdr, this.config.networkPassphrase);
    const submitted = await this.withTimeout('sendTransaction', this.server.sendTransaction(transaction));
    if (submitted.status === 'ERROR') {
      const message = formatTransactionFailure(submitted);
      throw new TransactionFailedError(submitted.hash, message, contractErrorCode(message));
    }

    const pollIntervalMs = options?.pollIntervalMs ?? this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options?.timeoutMs ?? this.config.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.read('getTransaction', () => this.server.getTransaction(submitted.hash));
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        const message = formatTransactionFailure(result);
        throw new TransactionFailedError(result.txHash, message, contractErrorCode(message));
      }
      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    throw new RpcTimeoutError('transaction confirmation', timeoutMs);
  }

  /**
   * Polls `getProposal()` until the proposal reaches `targetStatus` (issue #274).
   *
   * Use it after `finalize()` or `execute()` to wait for the status change the
   * transaction causes. Every poll bypasses the read cache, so a cached `Active`
   * cannot hide a `Queued` that has already landed.
   *
   * @param proposalId Proposal to watch.
   * @param targetStatus Status to wait for.
   * @param options.pollIntervalMs Delay between polls (default: the client's
   * `pollIntervalMs`, then {@link DEFAULT_POLL_INTERVAL_MS}).
   * @param options.timeoutMs Give up after this long (default {@link DEFAULT_CONFIRMATION_TIMEOUT_MS}).
   * @returns The proposal as observed when it first had `targetStatus`.
   * @throws {ProposalNotFoundError} the proposal does not exist.
   * @throws {ProposalStatusTimeoutError} the status was not reached in time.
   * @example
   * await client.submitAndWait(signedFinalizeXdr);
   * const queued = await client.waitForProposalStatus(7n, 'Queued');
   */
  async waitForProposalStatus(
    proposalId: bigint,
    targetStatus: ProposalStatus,
    options?: WaitForStatusOptions,
  ): Promise<Proposal> {
    const pollIntervalMs = options?.pollIntervalMs ?? this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const proposal = await this.getProposal(proposalId, { bypassCache: true });
      if (!proposal) throw new ProposalNotFoundError(proposalId);
      if (proposal.status === targetStatus) return proposal;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new ProposalStatusTimeoutError(proposalId, targetStatus, proposal.status, timeoutMs);
      }
      await delay(Math.min(pollIntervalMs, remainingMs));
    }
  }

  /**
   * Previews the fee a built transaction will pay, before it is signed (issue #277).
   *
   * Simulates the transaction again, so the resource fee reflects current network
   * pricing rather than the value captured when it was built. Works on every
   * `build*` output. A resource fee the transaction already declares is replaced
   * by the fresh estimate, so it is never counted twice.
   *
   * Simulation is read-only: nothing is signed or submitted.
   *
   * @param transactionXdr Base64 transaction XDR, as returned by a `build*` method.
   * @returns Fees in stroops.
   * @throws {Error} the simulation failed.
   * @example
   * const xdr = await client.buildVote(voter, 7n, 1);
   * const fee = await client.estimateFees(xdr);
   * showUser(`Network fee: ${Number(fee.totalFee) / 10_000_000} XLM`);
   * const { signedXdr } = await signWithFreighter(xdr, { networkPassphrase });
   */
  async estimateFees(transactionXdr: string): Promise<FeeEstimate> {
    const tx = TransactionBuilder.fromXDR(transactionXdr, this.config.networkPassphrase);
    if (!(tx instanceof Transaction)) {
      throw new Error('estimateFees does not accept fee-bump transactions');
    }

    const simulation = await this.read('simulate:estimateFees', () => this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Fee estimate failed: ${simulation.error}`);
    }

    const resourceFee = BigInt(simulation.minResourceFee);
    const inclusionFee = BigInt(tx.fee) - declaredResourceFee(tx);
    return { inclusionFee, resourceFee, totalFee: inclusionFee + resourceFee };
  }

  /**
   * Builds, simulates and assembles a signable transaction.
   *
   * Fetches the source account for its sequence number, simulates first so
   * the returned transaction carries an accurate resource footprint, and
   * returns base64 XDR for the caller to sign (e.g. with Freighter) and
   * submit. Simulation failures are re-thrown as typed governance errors
   * where the contract code is recognisable.
   */
  private async buildGovernanceTransaction(
    source: string,
    method: string,
    ...args: xdr.ScVal[]
  ): Promise<string> {
    const sourceAccount = await this.server.getAccount(source);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.governance.call(method, ...args))
      .setTimeout(30)
      .build();

    try {
      const prepared = await this.server.prepareTransaction(tx);
      return prepared.toXDR();
    } catch (error) {
      throw mapGovernanceSimulationError(method, error);
    }
  }

  private async buildTokenTransaction(
    source: string,
    method: string,
    ...args: xdr.ScVal[]
  ): Promise<string> {
    const token = this.requireToken();
    const sourceAccount = await this.server.getAccount(source);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(token.call(method, ...args))
      .setTimeout(30)
      .build();

    try {
      const prepared = await this.server.prepareTransaction(tx);
      return prepared.toXDR();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Simulation of ${method} failed: ${message}`);
    }
  }

  // ─── Transaction Builders ────────────────────────────────────────────────
  // These return unsigned XDR strings — the caller signs with Freighter and submits.

  /**
   * Builds signable XDR for `create_proposal(proposer, title, description, metadata_uri)` (issue #113, #446).
   *
   * Creates a new governance proposal. `proposer` must sign and must hold at
   * least `proposalThreshold` tokens at the governance contract's snapshot
   * ledger. `source` pays the fee and defaults to `proposer`.
   *
   * @param metadataUri - Optional URI linking to off-chain proposal metadata.
   *   Defaults to `''`.  Must be passed to satisfy the contract's four-argument
   *   signature — omitting it caused simulation failures (#446).
   * @throws {Error} proposal threshold or other contract errors.
   */
  async buildCreateProposal(proposer: string, title: string, description: string, metadataUri: string = '', source?: string): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? proposer,
      'create_proposal',
      new Address(proposer).toScVal(),
      nativeToScVal(title, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(metadataUri, { type: 'string' }),
    );
  }

  /**
   * Builds signable XDR for `create_cosponsored_proposal` (issue #451).
   *
   * Note: Every address in `cosponsors` must also sign the resulting transaction
   * in addition to `proposer`. `source` pays the fee and defaults to `proposer`.
   *
   * @example
   * const xdr = await client.buildCreateCosponsoredProposal(
   *   proposer,
   *   [cosponsorAddress],
   *   'Treasury grant',
   *   'Fund ecosystem tooling',
   * );
   */
  async buildCreateCosponsoredProposal(
    proposer: string,
    cosponsors: string[],
    title: string,
    description: string,
    metadataUri = '',
    source?: string,
  ): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? proposer,
      'create_cosponsored_proposal',
      new Address(proposer).toScVal(),
      xdr.ScVal.scvVec(cosponsors.map(addr => new Address(addr).toScVal())),
      nativeToScVal(title, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(metadataUri, { type: 'string' }),
    );
  }

  /**
   * Builds signable XDR for `create_conviction_proposal` (issue #451).
   *
   * @example
   * const xdr = await client.buildCreateConvictionProposal(
   *   proposer,
   *   'Long-term grant',
   *   'Conviction-weighted funding proposal',
   * );
   */
  async buildCreateConvictionProposal(
    proposer: string,
    title: string,
    description: string,
    metadataUri = '',
    source?: string,
  ): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? proposer,
      'create_conviction_proposal',
      new Address(proposer).toScVal(),
      nativeToScVal(title, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(metadataUri, { type: 'string' }),
    );
  }

  /**
   * Builds signable XDR for `veto(guardian, proposal_id, reason)` (#453).
   * The connected guardian must authorize the transaction. The reason must be
   * non-empty and no longer than the contract limit.
   * @throws {GovernanceContractError} for Unauthorized, EmptyVetoReason,
   * VetoReasonTooLong, VetoWindowClosed, or other contract errors.
   */
  async buildVeto(guardian: string, proposalId: bigint, reason: string, source?: string): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? guardian,
      'veto',
      new Address(guardian).toScVal(),
      nativeToScVal(proposalId, { type: 'u64' }),
      nativeToScVal(reason, { type: 'string' }),
    );
  }

  /**
   * Builds signable XDR for `vote(voter, proposal_id, support)` (issue #114).
   *
   * Casts a vote on an active proposal. `support` is `0` (Against), `1` (For),
   * or `2` (Abstain). `voter` must sign. A voter who has already voted may
   * vote again while the window is open to change their choice. `source` pays
   * the fee and defaults to `voter`.
   *
   * @throws {ProposalNotFoundError} unknown proposal id.
   * @throws {VotingNotActiveError} proposal voting window is closed.
   */
  async buildVote(voter: string, proposalId: bigint, support: VoteSupport, source?: string): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? voter,
      'vote',
      new Address(voter).toScVal(),
      nativeToScVal(proposalId, { type: 'u64' }),
      nativeToScVal(support, { type: 'u32' }),
    );
  }

  /** Assign voting power without moving tokens. The holder must authorize. */
  async buildDelegate(delegator: string, delegatee: string, source?: string): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? delegator,
      'delegate',
      new Address(delegator).toScVal(),
      new Address(delegatee).toScVal(),
    );
  }

  /** Clear delegation and restore the holder's own voting power. */
  async buildUndelegate(delegator: string, source?: string): Promise<string> {
    return this.buildGovernanceTransaction(
      source ?? delegator,
      'undelegate',
      new Address(delegator).toScVal(),
    );
  }

  /**
   * Builds signable XDR for `finalize(proposal_id)` (issue #115).
   *
   * `finalize` takes no signer in the contract — anyone may call it once the
   * voting window has closed — so the fee-paying `source` account is an
   * explicit parameter. The returned XDR is unsigned; sign with Freighter.
   *
   * @throws {ProposalNotFoundError} unknown proposal id.
   * @throws {VotingNotActiveError} voting window has not closed yet.
   */
  async buildFinalize(source: string, proposalId: bigint): Promise<string> {
    return this.buildGovernanceTransaction(
      source,
      'finalize',
      nativeToScVal(proposalId, { type: 'u64' }),
    );
  }

  /**
   * Builds signable XDR for `execute(proposal_id)` (issue #115).
   *
   * `execute(executor, proposal_id)` requires the executor's authorization, so
   * `source` is both the executor and the fee payer. Only a `Queued` proposal
   * whose timelock has expired can be executed.
   *
   * @throws {ProposalNotFoundError} unknown proposal id.
   * @throws {ProposalNotPassedError} proposal is not `Queued` (still active,
   * failed, already executed, or cancelled).
   * @throws {TimelockNotExpiredError} timelock has not elapsed yet.
   */
  async buildExecute(source: string, proposalId: bigint): Promise<string> {
    return this.buildGovernanceTransaction(
      source,
      'execute',
      new Address(source).toScVal(),
      nativeToScVal(proposalId, { type: 'u64' }),
    );
  }

  /**
   * Builds signable XDR for `cancel(caller, proposal_id)` (issue #116).
   *
   * Restricted by the contract to the proposer or the admin — anyone else
   * fails with `Unauthorized`. `caller` must sign (via Freighter); `source`
   * pays the fee and defaults to `caller` for the common single-wallet flow.
   */
  async buildCancel(caller: string, proposalId: bigint, source?: string): Promise<string> {
    const feePayer = source ?? caller;
    return this.buildGovernanceTransaction(
      feePayer,
      'cancel',
      new Address(caller).toScVal(),
      nativeToScVal(proposalId, { type: 'u64' }),
    );
  }

  /**
   * Builds signable XDR for `mark_expired(proposal_id)` (issue #456).
   * Anyone may mark an expired proposal, so `source` is the explicit fee payer.
   */
  async buildMarkExpired(source: string, proposalId: bigint): Promise<string> {
    return this.buildGovernanceTransaction(
      source,
      'mark_expired',
      nativeToScVal(proposalId, { type: 'u64' }),
    );
  }

  /**
   * Builds signable XDR for `extend_proposal_ttl(proposal_id)` (issue #456).
   * Anyone may extend the entry lifetime, so `source` pays the transaction fee.
   */
  async buildExtendProposalTtl(source: string, proposalId: bigint): Promise<string> {
    return this.buildGovernanceTransaction(
      source,
      'extend_proposal_ttl',
      nativeToScVal(proposalId, { type: 'u64' }),
    );
  }

  // ─── Token builders (issue #117) ─────────────────────────────────────────

  /**
   * Builds signable XDR for `transfer(from, to, amount)`.
   * `from` must sign; `source` pays the fee and defaults to `from`.
   */
  async buildTransfer(from: string, to: string, amount: bigint, source?: string): Promise<string> {
    return this.buildTokenTransaction(
      source ?? from,
      'transfer',
      new Address(from).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
    );
  }

  /**
   * Builds signable XDR for `approve(owner, spender, amount,
   * expiration_ledger)`.
   *
   * `expirationLedger` is a ledger sequence (u32), matching the contract's
   * current signature: a live approval (`amount > 0`) must not expire in the
   * past, while `amount == 0` revokes and accepts any expiration. `owner`
   * must sign; `source` pays the fee and defaults to `owner`.
   */
  async buildApprove(
    owner: string,
    spender: string,
    amount: bigint,
    expirationLedger: number,
    source?: string,
  ): Promise<string> {
    return this.buildTokenTransaction(
      source ?? owner,
      'approve',
      new Address(owner).toScVal(),
      new Address(spender).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(expirationLedger, { type: 'u32' }),
    );
  }

  /**
   * Builds signable XDR for `transfer_from(spender, from, to, amount)`.
   * `spender` must sign (the owner consented via `approve`); `source` pays
   * the fee and defaults to `spender`.
   */
  async buildTransferFrom(
    spender: string,
    from: string,
    to: string,
    amount: bigint,
    source?: string,
  ): Promise<string> {
    return this.buildTokenTransaction(
      source ?? spender,
      'transfer_from',
      new Address(spender).toScVal(),
      new Address(from).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
    );
  }

  // ── Staking (issue #454) ─────────────────────────────────────────────────

  /**
   * Lock `amount` tokens for `durationLedgers` ledgers to earn a vote-power boost.
   * The staked amount is included in `lockedBalance` until the lock expires.
   */
  async buildStake(staker: string, amount: bigint, durationLedgers: number, source?: string): Promise<string> {
    return this.buildTokenTransaction(
      source ?? staker,
      'stake',
      new Address(staker).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(durationLedgers, { type: 'u32' }),
    );
  }

  /**
   * Release a fully-expired stake back to the holder's spendable balance.
   * Panics with `LockNotExpired` if the lock period has not passed.
   */
  async buildUnstake(staker: string, source?: string): Promise<string> {
    return this.buildTokenTransaction(
      source ?? staker,
      'unstake',
      new Address(staker).toScVal(),
    );
  }

  /**
   * Amount currently locked in an active stake (zero if no active stake).
   * Included in the holder's total balance but not in `spendableBalance`.
   */
  async lockedBalance(holder: string, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('lockedBalance', [holder], options, async () => {
      const raw = await this.simulateToken<bigint | number>('locked_balance', new Address(holder).toScVal());
      return BigInt(raw);
    });
  }

  /**
   * Liquid (non-locked) balance: `balance - lockedBalance`.
   * This is the amount the holder can transfer or approve immediately.
   */
  async spendableBalance(holder: string, options?: ReadOptions): Promise<bigint> {
    return this.cache.read('spendableBalance', [holder], options, async () => {
      const raw = await this.simulateToken<bigint | number>('spendable_balance', new Address(holder).toScVal());
      return BigInt(raw);
    });
  }

  /**
   * Preview the vote-power multiplier for a given `amount` and `durationLedgers`.
   * Returns the boosted voting power (not the multiplier ratio) as the contract
   * would compute it via `lock_boost(amount, duration)`.
   */
  async previewStakeBoost(amount: bigint, durationLedgers: number, options?: ReadOptions): Promise<bigint> {
    const raw = await this.simulateToken<bigint | number>(
      'lock_boost',
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(durationLedgers, { type: 'u32' }),
    );
    return BigInt(raw);
  }

  // ── Governance computed views (issue #455) ───────────────────────────────

  /**
   * Derived display phase for a proposal, computed server-side so the client
   * does not need to compare ledger sequences.
   * Returns one of: `'Pending' | 'Voting' | 'TimelockPending' | ProposalStatus`.
   */
  async getProposalPhase(proposalId: bigint, options?: ReadOptions): Promise<string> {
    return this.simulate<string>('get_proposal_phase', nativeToScVal(proposalId, { type: 'u64' }));
  }

  /**
   * Fraction of the quorum requirement satisfied so far.
   * Returns a value in `[0, 10_000]` where 10_000 means quorum is exactly met.
   */
  async getQuorumProgress(proposalId: bigint, options?: ReadOptions): Promise<number> {
    const raw = await this.simulate<number | bigint>('get_quorum_progress', nativeToScVal(proposalId, { type: 'u64' }));
    return Number(raw);
  }

  /** Whether the current for-votes satisfy the quorum requirement. */
  async hasReachedQuorum(proposalId: bigint, options?: ReadOptions): Promise<boolean> {
    const raw = await this.simulate<boolean>('has_reached_quorum', nativeToScVal(proposalId, { type: 'u64' }));
    return raw === true;
  }

  /**
   * Aggregate governance stats: proposal counts by terminal status, total supply,
   * and participation rate.
   */
  async getGovernanceStats(options?: ReadOptions): Promise<GovernanceStats> {
    const raw = await this.simulate<RawGovernanceStats>('get_governance_stats');
    return {
      totalProposals: Number(raw.total_proposals),
      activeProposals: Number(raw.active_proposals),
      queuedProposals: Number(raw.queued_proposals),
      executedProposals: Number(raw.executed_proposals),
      failedProposals: Number(raw.failed_proposals),
      cancelledProposals: Number(raw.cancelled_proposals ?? 0),
      expiredProposals: Number(raw.expired_proposals ?? 0),
      vetoedProposals: Number(raw.vetoed_proposals ?? 0),
    };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isTransientRpcError(error: unknown): boolean {
  const candidate = error as { response?: { status?: number }; status?: number; code?: string; message?: string };
  const status = candidate.response?.status ?? candidate.status;
  return (typeof status === 'number' && (status === 408 || status === 429 || status >= 500))
    || candidate.code === 'ECONNRESET'
    || candidate.code === 'ETIMEDOUT'
    || /(?:timeout|temporar|network|fetch failed|rate limit|try again)/i.test(candidate.message ?? '');
}

function isTimeoutError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === 'ECONNABORTED' || candidate.code === 'ETIMEDOUT' || /timeout/i.test(candidate.message ?? '');
}

function formatTransactionFailure(response: { hash?: string; txHash?: string; errorResult?: unknown; resultXdr?: unknown }): string {
  const detail = response.errorResult ?? response.resultXdr;
  return detail ? `Transaction ${response.hash ?? response.txHash ?? ''} failed: ${String(detail)}` : `Transaction ${response.hash ?? response.txHash ?? ''} failed`;
}

/** Resource fee a prepared Soroban transaction already declares; zero for classic transactions. */
function declaredResourceFee(tx: Transaction): bigint {
  const envelope = tx.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') return BigInt(0);
  const ext = envelope.v1.tx.ext;
  return ext.type === 'sorobanData' ? ext.sorobanData.resourceFee : BigInt(0);
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
  status: [string];
  timelock_period?: number;
  execution_grace_period?: number;
  metadata_uri?: string;
  kind?: [string];
}

interface RawConfig {
  token: string;
  quorum_bps: number;
  voting_period: number;
  timelock_period: number;
  proposal_threshold: bigint;
  admin: string;
  guardian?: string;
  execution_grace_period?: number;
  paused?: boolean;
  proposal_deposit?: bigint;
  proposer_cooldown?: number;
}

interface RawGovernanceStats {
  total_proposals: number | bigint;
  active_proposals: number | bigint;
  queued_proposals: number | bigint;
  executed_proposals: number | bigint;
  failed_proposals: number | bigint;
  cancelled_proposals?: number | bigint;
  expired_proposals?: number | bigint;
  vetoed_proposals?: number | bigint;
}

interface RawConvictionTally {
  for_conviction: bigint;
  against_conviction: bigint;
  updated_ledger: number;
}

function decodeConvictionTally(raw: RawConvictionTally): ConvictionTally {
  return {
    forConviction: raw.for_conviction,
    againstConviction: raw.against_conviction,
    updatedLedger: raw.updated_ledger,
  };
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
    status: decodeStatus(raw.status),
    timelockPeriod: raw.timelock_period ?? 0,
    executionGracePeriod: raw.execution_grace_period ?? 0,
    ...(raw.metadata_uri === undefined ? {} : { metadataUri: raw.metadata_uri }),
    kind: raw.kind ? (raw.kind[0] as 'Standard' | 'Upgrade') : 'Standard',
  };
}

/** On-chain statuses the contract can store on a Proposal. */
const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'Active', 'Failed', 'Queued', 'Executed', 'Cancelled', 'Expired', 'Vetoed',
];

/** Unit enum variant `[name]` → ProposalStatus, rejecting names the SDK does not know. */
function decodeStatus(raw: [string]): ProposalStatus {
  const name = raw[0];
  if (!(PROPOSAL_STATUSES as readonly string[]).includes(name)) {
    throw new Error(`Unknown ProposalStatus variant: ${String(name)}`);
  }
  return name as ProposalStatus;
}

export const TESTNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

export const MAINNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-rpc.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
};
