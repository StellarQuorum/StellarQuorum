import { SorobanRpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, Address, Account, xdr } from '@stellar/stellar-sdk';
import type { Proposal, GovernanceConfig, QuorumClientConfig, VoteSupport, GetProposalsOptions } from './types';

/**
 * Source account used for read-only simulation.
 *
 * Simulating a contract call still requires a source account to build the
 * transaction, but a simulation is never signed or submitted, so the all-zero
 * ed25519 account works and means reads need no funded account.
 */
const READ_ONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Default page size for paginated proposal listing (issue #118).
 *
 * Matches the recommendation in `docs/proposal-list-performance.md`: 50 cards
 * is one screenful, ~200 KiB per page at 4 KiB/proposal stays under public
 * RPC response caps, with diminishing returns above 50.
 */
export const DEFAULT_PAGE_SIZE = 50;

// ─── Typed governance errors (issue #115) ────────────────────────────────────
// The contract surfaces failures as `GovernanceError` codes; a simulation
// failure string looks like `... Error(Contract, #12) ...`. These map the
// timelock / status paths to typed errors so callers can branch on them
// instead of parsing strings.

export class ProposalNotFoundError extends Error {
  constructor(proposalId?: bigint | string) {
    super(`Proposal not found${proposalId !== undefined ? `: ${String(proposalId)}` : ''}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class VotingNotActiveError extends Error {
  constructor(message = 'Voting window is still open; proposal cannot be finalized yet') {
    super(message);
    this.name = 'VotingNotActiveError';
  }
}

export class ProposalNotPassedError extends Error {
  constructor(message = 'Proposal is not queued and cannot be executed') {
    super(message);
    this.name = 'ProposalNotPassedError';
  }
}

export class TimelockNotExpiredError extends Error {
  constructor(message = 'Timelock has not expired; proposal cannot be executed yet') {
    super(message);
    this.name = 'TimelockNotExpiredError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Caller is not authorized for this action') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function mapGovernanceSimulationError(method: string, raw: unknown): Error {
  const message = raw instanceof Error ? raw.message : String(raw);
  if (/#\s*3\b/.test(message) || /ProposalNotFound/.test(message)) {
    return new ProposalNotFoundError();
  }
  if (/#\s*4\b/.test(message) || /VotingNotActive/.test(message)) {
    return new VotingNotActiveError(`Simulation of ${method} failed: voting is not active (${message})`);
  }
  if (/#\s*7\b/.test(message) || /ProposalNotPassed/.test(message)) {
    return new ProposalNotPassedError(`Simulation of ${method} failed: proposal has not passed (${message})`);
  }
  if (/#\s*12\b/.test(message) || /TimelockNotExpired/.test(message)) {
    return new TimelockNotExpiredError(`Simulation of ${method} failed: timelock not expired (${message})`);
  }
  if (/#\s*2\b/.test(message) || /Unauthorized/.test(message)) {
    return new UnauthorizedError(`Simulation of ${method} failed: unauthorized (${message})`);
  }
  return new Error(`Simulation of ${method} failed: ${message}`);
}

export class QuorumClient {
  private server: SorobanRpc.Server;
  private governance: Contract;
  private token: Contract | null;
  private config: QuorumClientConfig;

  constructor(config: QuorumClientConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.governance = new Contract(config.governanceContractId);
    // tokenContractId is required by the config type but older callers
    // (e.g. bench RPC mode) only pass a governance id — stay usable and fail
    // with a clear message only when a token method is actually used.
    this.token = config.tokenContractId ? new Contract(config.tokenContractId) : null;
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

  async getProposalsByStatus(status: Proposal['status'], options?: GetProposalsOptions): Promise<Proposal[]> {
    // Filtering happens after pagination, so callers needing a complete
    // filtered set should omit pagination (fetch all, then filter).
    const all = await this.getAllProposals(options);
    return all.filter(p => p.status === status);
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
    return this.fetchProposalWindow(offset, limit);
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
    if (!options || (options.limit === undefined && options.offset === undefined)) {
      const count = await this.getProposalCount();
      const proposals = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) => this.getProposal(BigInt(i + 1)))
      );
      return proposals.filter(Boolean) as Proposal[];
    }
    const offset = options.offset ?? 0;
    // No explicit limit means "everything from offset onwards".
    if (options.limit === undefined) {
      const count = await this.getProposalCount();
      const total = Number(count);
      const remaining = Math.max(0, total - offset);
      return this.fetchProposalWindow(offset, remaining);
    }
    return this.fetchProposalWindow(offset, options.limit);
  }

  private async fetchProposalWindow(offset: number, limit: number): Promise<Proposal[]> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Invalid offset ${String(offset)}: must be a non-negative integer`);
    }
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(`Invalid limit ${String(limit)}: must be a non-negative integer`);
    }
    if (limit === 0) {
      return [];
    }
    const count = await this.getProposalCount();
    const total = Number(count);
    if (offset >= total) {
      return [];
    }
    const end = Math.min(total, offset + limit);
    const ids: bigint[] = [];
    // Proposal ids are 1-based; offset 0 → id 1.
    for (let id = offset + 1; id <= end; id += 1) {
      ids.push(BigInt(id));
    }
    const proposals = await Promise.all(ids.map(id => this.getProposal(id)));
    return proposals.filter(Boolean) as Proposal[];
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
  async balance(owner: string): Promise<bigint> {
    return this.simulateToken<bigint>(
      'balance',
      new Address(owner).toScVal(),
    );
  }

  /**
   * Balance of `owner` as of the end of `ledger` (snapshot voting power).
   */
  async getPastBalance(owner: string, ledger: number): Promise<bigint> {
    return this.simulateToken<bigint>(
      'get_past_balance',
      new Address(owner).toScVal(),
      nativeToScVal(ledger, { type: 'u32' }),
    );
  }

  /**
   * Amount `spender` may still draw from `owner` (0 once expired).
   */
  async allowance(owner: string, spender: string): Promise<bigint> {
    return this.simulateToken<bigint>(
      'allowance',
      new Address(owner).toScVal(),
      new Address(spender).toScVal(),
    );
  }

  /**
   * Total QUORUM supply.
   */
  async totalSupply(): Promise<bigint> {
    return this.simulateToken<bigint>('total_supply');
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
    return this.simulateWith<T>(this.governance, method, ...args);
  }

  private async simulateToken<T>(method: string, ...args: xdr.ScVal[]): Promise<T> {
    return this.simulateWith<T>(this.requireToken(), method, ...args);
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

    const simulation = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation of ${method} failed: ${simulation.error}`);
    }
    if (!simulation.result) {
      throw new Error(`Simulation of ${method} returned no result`);
    }

    return scValToNative(simulation.result.retval) as T;
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

  async buildCreateProposal(proposer: string, title: string, description: string): Promise<string> {
    // TODO: build transaction → governance.create_proposal(proposer, title, description)
    throw new Error('Not implemented');
  }

  async buildVote(voter: string, proposalId: bigint, support: VoteSupport): Promise<string> {
    // TODO: build transaction → governance.vote(voter, proposalId, support)
    throw new Error('Not implemented');
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
   * Like `finalize`, `execute` takes no signer in the contract, so `source`
   * pays the fee. Only a `Queued` proposal whose timelock has expired can be
   * executed.
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
}

export const TESTNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

export const MAINNET: Partial<QuorumClientConfig> = {
  rpcUrl: 'https://soroban-rpc.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
};
