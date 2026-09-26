/**
 * Freighter signing helper — the optional `@quorum/sdk/freighter` entry point.
 *
 * The root entry point never loads this module, so Node consumers that only
 * read chain state never pull `@stellar/freighter-api` into their bundle or
 * their process. Consumers opt in with:
 *
 * ```ts
 * import { signWithFreighter } from '@quorum/sdk/freighter';
 * const xdr = await client.buildVote(voter, proposalId, 1);
 * const { signedXdr } = await signWithFreighter(xdr, { networkPassphrase });
 * ```
 *
 * Every failure is a `FreighterError` with a machine-readable `code`, so
 * callers can branch on an absent or locked wallet instead of parsing text.
 */

/** Machine-readable reasons the wallet helper can fail. */
export enum FreighterErrorCode {
  /** The extension (or the browser environment) is missing. */
  NotInstalled = 'NOT_INSTALLED',
  /** The wallet is installed but locked, or the session is locked. */
  Locked = 'LOCKED',
  /** The user rejected the connection request. */
  AccessDenied = 'ACCESS_DENIED',
  /** The user rejected the signing request. */
  SigningRejected = 'SIGNING_REJECTED',
  /** Any other Freighter failure; the message carries Freighter's own text. */
  WalletError = 'WALLET_ERROR',
}

/** A typed Freighter failure. `code` says what to do; `message` says why. */
export class FreighterError extends Error {
  readonly code: FreighterErrorCode;

  constructor(code: FreighterErrorCode, message: string) {
    super(message);
    this.name = 'FreighterError';
    this.code = code;
  }
}

export interface SignWithFreighterOptions {
  /** Passphrase of the network the transaction was built for. */
  networkPassphrase: string;
  /** Account to sign with. Defaults to the address Freighter connects with. */
  address?: string;
}

export interface SignedTransaction {
  signedXdr: string;
  signerAddress: string;
}

/**
 * Minimal structural view of `@stellar/freighter-api` — only what this module
 * calls, so the published `.d.ts` never references the optional dependency.
 */
interface FreighterApi {
  isConnected?: () => Promise<{ isConnected?: boolean; error?: FreighterApiError }>;
  requestAccess: () => Promise<{ address?: string; error?: FreighterApiError }>;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr?: string; signerAddress?: string; error?: FreighterApiError }>;
}

interface FreighterApiError {
  code?: number;
  message?: string;
}

/** Which step of the flow produced a failure — decides the default code. */
type Phase = 'access' | 'sign';

const DECLINED = /declin|reject|denied|refus|cancel|not allowed/;
const LOCKED = /lock/;
const MISSING = /install|not found|not available|unsupported|no freighter/;

function text(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Maps a Freighter message onto a code. Phase is the fallback when the text is
 * unrecognised: a failure to connect is not access, a failure to sign is not a
 * signature.
 */
function codeFor(message: string, phase: Phase): FreighterErrorCode {
  const lower = message.toLowerCase();
  if (LOCKED.test(lower)) return FreighterErrorCode.Locked;
  if (MISSING.test(lower)) return FreighterErrorCode.NotInstalled;
  if (DECLINED.test(lower)) {
    return phase === 'sign' ? FreighterErrorCode.SigningRejected : FreighterErrorCode.AccessDenied;
  }
  if (phase === 'access') return FreighterErrorCode.AccessDenied;
  if (phase === 'sign') return FreighterErrorCode.SigningRejected;
  return FreighterErrorCode.WalletError;
}

function describe(code: FreighterErrorCode, detail: string): string {
  switch (code) {
    case FreighterErrorCode.NotInstalled:
      return `Freighter is not available (${detail}). Install the extension from https://freighter.app and \`npm install @stellar/freighter-api\`, then reload.`;
    case FreighterErrorCode.Locked:
      return `The Freighter wallet is locked (${detail}). Unlock the extension and try again.`;
    case FreighterErrorCode.AccessDenied:
      return `The Freighter connection request was not granted (${detail}).`;
    case FreighterErrorCode.SigningRejected:
      return `The transaction was not signed (${detail}).`;
    default:
      return `Freighter request failed (${detail}).`;
  }
}

/** Turns a Freighter error payload or thrown value into a `FreighterError`. */
function toFreighterError(error: unknown, phase: Phase): FreighterError {
  const detail = text(error);
  const code = codeFor(detail, phase);
  return new FreighterError(code, describe(code, detail));
}

function inBrowser(): boolean {
  return typeof (globalThis as { window?: unknown }).window !== 'undefined'
    && (globalThis as { window?: unknown }).window !== null;
}

/** Picks the callable surface out of an ESM namespace or a CJS export object. */
function apiFrom(mod: unknown): FreighterApi | null {
  const candidates = [mod, (mod as { default?: unknown }).default];
  for (const candidate of candidates) {
    const api = candidate as Partial<FreighterApi> | null | undefined;
    if (api && typeof api.requestAccess === 'function' && typeof api.signTransaction === 'function') {
      return api as FreighterApi;
    }
  }
  return null;
}

/**
 * Loads the optional Freighter API.
 *
 * The import is dynamic on purpose: a bundler that never sees the helper never
 * includes it, and a runtime that has neither the package nor a browser gets a
 * typed `NotInstalled` error instead of a module-resolution crash.
 */
async function loadFreighter(): Promise<FreighterApi> {
  if (!inBrowser()) {
    throw new FreighterError(
      FreighterErrorCode.NotInstalled,
      describe(
        FreighterErrorCode.NotInstalled,
        'no browser environment — Freighter only exists as an extension page API',
      ),
    );
  }

  let api: FreighterApi | null;
  try {
    api = apiFrom(await import('@stellar/freighter-api'));
  } catch (error) {
    // A rejected import always means the package itself is absent.
    throw new FreighterError(
      FreighterErrorCode.NotInstalled,
      describe(FreighterErrorCode.NotInstalled, text(error)),
    );
  }
  if (!api) {
    throw new FreighterError(
      FreighterErrorCode.NotInstalled,
      describe(FreighterErrorCode.NotInstalled, '@stellar/freighter-api exposed no signing API'),
    );
  }
  return api;
}

/** True when a browser and the Freighter API can be reached. Never throws. */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const api = await loadFreighter();
    if (typeof api.isConnected !== 'function') return true;
    const state = await api.isConnected();
    if (state?.error) return false;
    return state?.isConnected !== false;
  } catch {
    return false;
  }
}

/**
 * Detects the extension and requests access, returning the connected address.
 *
 * @throws {FreighterError} `NOT_INSTALLED` or `ACCESS_DENIED` (incl. `LOCKED`).
 */
export async function getFreighterAddress(): Promise<string> {
  const { address } = await connect();
  return address;
}

async function connect(): Promise<{ api: FreighterApi; address: string }> {
  const api = await loadFreighter();

  let access: { address?: string; error?: FreighterApiError };
  try {
    access = await api.requestAccess();
  } catch (error) {
    throw toFreighterError(error, 'access');
  }
  if (access?.error) throw toFreighterError(access.error, 'access');
  if (!access?.address) {
    throw new FreighterError(
      FreighterErrorCode.AccessDenied,
      describe(FreighterErrorCode.AccessDenied, 'no address returned'),
    );
  }
  return { api, address: access.address };
}

/**
 * Signs built transaction XDR with Freighter: detect, request access, sign.
 *
 * @param xdr Unsigned base64 transaction XDR, e.g. from a `build*` method.
 * @param options Network passphrase the transaction was built for.
 * @throws {TypeError} Missing XDR or network passphrase.
 * @throws {FreighterError} Absent, locked or uncooperative wallet.
 */
export async function signWithFreighter(
  xdr: string,
  options: SignWithFreighterOptions,
): Promise<SignedTransaction> {
  if (typeof xdr !== 'string' || xdr.length === 0) {
    throw new TypeError('signWithFreighter: xdr must be a non-empty string');
  }
  if (!options || typeof options.networkPassphrase !== 'string' || options.networkPassphrase.length === 0) {
    throw new TypeError('signWithFreighter: options.networkPassphrase is required');
  }

  const { api, address } = await connect();
  const signer = options.address ?? address;

  let signed: { signedTxXdr?: string; signerAddress?: string; error?: FreighterApiError };
  try {
    signed = await api.signTransaction(xdr, {
      networkPassphrase: options.networkPassphrase,
      address: signer,
    });
  } catch (error) {
    throw toFreighterError(error, 'sign');
  }
  if (signed?.error) throw toFreighterError(signed.error, 'sign');
  if (!signed?.signedTxXdr) {
    throw new FreighterError(
      FreighterErrorCode.WalletError,
      describe(FreighterErrorCode.WalletError, 'no signed transaction returned'),
    );
  }

  return { signedXdr: signed.signedTxXdr, signerAddress: signed.signerAddress ?? signer };
}
