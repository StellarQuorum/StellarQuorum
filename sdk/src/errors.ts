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
