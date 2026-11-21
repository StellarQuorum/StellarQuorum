/**
 * Mirror of `GovernanceError` in contracts/governance/src/lib.rs.
 *
 * Values must match the Rust `#[repr(u32)]` discriminants exactly; the
 * contract reports failures only as `Error(Contract, #N)`. errors.test.ts
 * reads the Rust source and fails if the two drift apart.
 */
export enum GovernanceError {
  AlreadyInitialized = 1,
  Unauthorized = 2,
  ProposalNotFound = 3,
  VotingNotActive = 4,
  AlreadyVoted = 5,
  QuorumNotReached = 6,
  ProposalNotPassed = 7,
  AlreadyExecuted = 8,
  BelowProposalThreshold = 9,
  InvalidVoteChoice = 10,
  VotingPeriodEnded = 11,
  TimelockNotExpired = 12,
  Overflow = 13,
  NoVotingPower = 14,
  ExecutionExpired = 15,
  ContractPaused = 16,
  InvalidQuorumBps = 17,
  NotInitialized = 18,
  EmptyTitle = 19,
  TitleTooLong = 20,
  DescriptionTooLong = 21,
  MinimumQuorumRequired = 22,
  MinimumTimelockRequired = 23,
  EmptyVetoReason = 24,
  VetoReasonTooLong = 25,
  VetoWindowClosed = 26,
  TargetNotAllowed = 27,
  InvalidCosponsors = 28,
  InvalidAmount = 29,
  InsufficientDeposit = 30,
  NotExecutable = 31,
  ProposalNotCancellable = 32,
  ProposerOnCooldown = 33,
  VotingNotStarted = 34,
  TooManyActions = 35,
  ActionFailed = 36,
  TokenDelegationFailed = 37,
  ActionAddedAfterVotingStarted = 38,
}

/** Mirror of `TokenError` in contracts/token/src/lib.rs. Same rules as above. */
export enum TokenError {
  AlreadyInitialized = 1,
  Unauthorized = 2,
  InsufficientBalance = 3,
  InsufficientAllowance = 4,
  InvalidAmount = 5,
  Overflow = 6,
  InvalidExpiration = 7,
  InvalidSupply = 8,
  InvalidDecimals = 9,
  NotStaked = 12,
  AlreadyStaked = 11,
  LockNotExpired = 13,
  NotInitialized = 14,
  InvalidDuration = 10,
}

/** Human-readable descriptions for every on-chain governance error code. */
export const GOVERNANCE_ERROR_MESSAGES: Readonly<Record<GovernanceError, string>> = {
  [GovernanceError.AlreadyInitialized]: 'The contract is already initialized',
  [GovernanceError.Unauthorized]: 'The caller is not authorized',
  [GovernanceError.ProposalNotFound]: 'The proposal does not exist',
  [GovernanceError.VotingNotActive]: 'Voting is not active for this proposal',
  [GovernanceError.AlreadyVoted]: 'The caller has already voted',
  [GovernanceError.QuorumNotReached]: 'The proposal did not reach quorum',
  [GovernanceError.ProposalNotPassed]: 'The proposal did not pass',
  [GovernanceError.AlreadyExecuted]: 'The proposal has already been executed',
  [GovernanceError.BelowProposalThreshold]: 'The proposer is below the proposal threshold',
  [GovernanceError.InvalidVoteChoice]: 'The vote choice is invalid',
  [GovernanceError.VotingPeriodEnded]: 'The voting period has ended',
  [GovernanceError.TimelockNotExpired]: 'The proposal timelock has not expired',
  [GovernanceError.Overflow]: 'A governance calculation overflowed',
  [GovernanceError.NoVotingPower]: 'The account has no voting power',
  [GovernanceError.ExecutionExpired]: 'The proposal execution window has expired',
  [GovernanceError.ContractPaused]: 'The governance contract is paused',
  [GovernanceError.InvalidQuorumBps]: 'The quorum basis points are invalid',
  [GovernanceError.NotInitialized]: 'The contract has not been initialized',
  [GovernanceError.EmptyTitle]: 'The proposal title is empty',
  [GovernanceError.TitleTooLong]: 'The proposal title is too long',
  [GovernanceError.DescriptionTooLong]: 'The proposal description is too long',
  [GovernanceError.MinimumQuorumRequired]: 'The quorum is below the contract minimum',
  [GovernanceError.MinimumTimelockRequired]: 'The timelock is below the contract minimum',
  [GovernanceError.EmptyVetoReason]: 'A veto reason is required',
  [GovernanceError.VetoReasonTooLong]: 'The veto reason is too long',
  [GovernanceError.VetoWindowClosed]: 'The proposal veto window has closed',
  [GovernanceError.TargetNotAllowed]: 'The proposal target is not allowlisted',
  [GovernanceError.InvalidCosponsors]: 'The proposal cosponsors are invalid',
  [GovernanceError.InvalidAmount]: 'The amount is invalid',
  [GovernanceError.InsufficientDeposit]: 'The proposer deposit is insufficient',
  [GovernanceError.NotExecutable]: 'The proposal has no executable actions',
  [GovernanceError.ProposalNotCancellable]: 'The proposal cannot be cancelled in its current state',
  [GovernanceError.ProposerOnCooldown]: 'The proposer is still on cooldown',
  [GovernanceError.VotingNotStarted]: 'The voting period has not started',
  [GovernanceError.TooManyActions]: 'The proposal contains too many actions',
  [GovernanceError.ActionFailed]: 'A proposal action failed',
  [GovernanceError.TokenDelegationFailed]: 'The token contract rejected the delegation update',
  [GovernanceError.ActionAddedAfterVotingStarted]: 'Proposal actions cannot change after voting starts',
};

/** A typed error for any governance code without a specialized SDK subclass. */
export class GovernanceContractError extends Error {
  readonly code: GovernanceError;

  constructor(code: GovernanceError, message = GOVERNANCE_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'GovernanceContractError';
    this.code = code;
  }
}

/** Map a numeric contract code to the SDK's exhaustive governance enum. */
export function governanceErrorFromCode(code: number): GovernanceError | undefined {
  return Object.prototype.hasOwnProperty.call(GOVERNANCE_ERROR_MESSAGES, code)
    ? code as GovernanceError
    : undefined;
}

export class RpcTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
  }
}

export class TransactionFailedError extends Error {
  readonly transactionHash: string;
  readonly contractErrorCode?: number;

  constructor(hash: string, message: string, contractErrorCode?: number) {
    super(message);
    this.name = 'TransactionFailedError';
    this.transactionHash = hash;
    this.contractErrorCode = contractErrorCode;
  }
}

/**
 * Extracts `N` from an `Error(Contract, #N)` host error, whether given the
 * error object, its message, or a simulation error string.
 */
export function contractErrorCode(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Maps a raw governance contract failure to `GovernanceError`, if it is one. */
export function parseGovernanceError(error: unknown): GovernanceError | undefined {
  const code = contractErrorCode(error);
  return code !== undefined && code in GovernanceError ? code : undefined;
}

/** Maps a raw token contract failure to `TokenError`, if it is one. */
export function parseTokenError(error: unknown): TokenError | undefined {
  const code = contractErrorCode(error);
  return code !== undefined && code in TokenError ? code : undefined;
}
