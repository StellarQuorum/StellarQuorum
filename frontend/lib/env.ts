// Issue #143: contract IDs and the RPC URL come from the environment, and a
// missing or mistyped value otherwise surfaces as a decoding error from deep
// inside the Stellar SDK. Everything the app reads is validated here, once, and
// the failure names the variable and what was wrong with it.
//
// The variables are read one by one with a static `process.env.NEXT_PUBLIC_*`
// expression — Next inlines those textually, so a computed lookup like
// `process.env[name]` would silently be empty in the client bundle.

export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
export const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const DEFAULT_SITE_URL = "https://quorum.stellar.org";

/** Every variable the frontend reads, and what happens when it is unset. */
export const ENV_VARS = [
  {
    name: "NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID",
    required: false,
    fallback: "fixture mode",
    description:
      "Governance contract to read. Must be a valid Soroban contract ID (56-character strkey starting with C). Required unless fixture mode is on.",
  },
  {
    name: "NEXT_PUBLIC_TOKEN_CONTRACT_ID",
    required: false,
    fallback: "the token address in get_config()",
    description:
      "Token contract balances are read from. Same format as the governance contract ID. Optional.",
  },
  {
    name: "NEXT_PUBLIC_STELLAR_RPC_URL",
    required: false,
    fallback: DEFAULT_RPC_URL,
    description: "Soroban RPC endpoint. Must be an absolute http(s) URL.",
  },
  {
    name: "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
    required: false,
    fallback: DEFAULT_NETWORK_PASSPHRASE,
    description: "Passphrase of the network the contract was deployed to. Must match the RPC endpoint.",
  },
  {
    name: "NEXT_PUBLIC_USE_FIXTURE",
    required: false,
    fallback: "1 when no contract ID is set",
    description:
      "1 serves the bundled mock proposals; 0 requires a contract ID and fails fast without one. Any other value is a configuration error.",
  },
  {
    name: "NEXT_PUBLIC_SITE_URL",
    required: false,
    fallback: DEFAULT_SITE_URL,
    description: "Absolute origin of the deployment. Used by robots.txt and the sitemap.",
  },
] as const;

/** Raw values as read from the environment, before any validation. */
export interface EnvInput {
  governanceContractId?: string;
  tokenContractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  useFixture?: string;
  siteUrl?: string;
}

/** The validated environment, as the rest of the app consumes it. */
export interface AppEnv {
  useFixture: boolean;
  governanceContractId: string | null;
  tokenContractId: string | null;
  stellarRpcUrl: string;
  networkPassphrase: string;
  siteUrl: string;
}

/** Thrown when the environment cannot produce a working configuration. */
export class EnvError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n` +
        "Fix the values in frontend/.env.local; every variable is documented in frontend/.env.example.",
    );
    this.name = "EnvError";
    this.problems = problems;
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Version byte of a contract strkey: (2 << 3) === 'C'. */
const CONTRACT_VERSION_BYTE = 2 << 3;

function base32Decode(value: string): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // Fewer than five bits left is base32 padding; five or more means the last
  // characters hold data that a byte would have been made of.
  return bits >= 5 ? null : bytes;
}

function crc16XModem(data: number[]): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * A Stellar strkey: a base32 payload with a leading version byte and a trailing
 * two-byte CRC-16/XModem checksum, in little-endian order.
 *
 * Checking the checksum is what makes this worth more than a length and prefix
 * test — a contract ID with a transposed character has the right shape and is
 * still rejected here, instead of at the RPC node.
 */
export function isValidStrkey(value: string, versionByte: number): boolean {
  if (!/^[A-Z2-7]+$/.test(value)) return false;
  const decoded = base32Decode(value);
  if (!decoded || decoded.length < 3) return false;
  const payload = decoded.slice(0, -2);
  const checksum = decoded[decoded.length - 2] | (decoded[decoded.length - 1] << 8);
  return payload[0] === versionByte && crc16XModem(payload) === checksum;
}

/**
 * A Soroban contract ID: a 56-character strkey over a 32-byte hash, with the
 * `C` version byte. A token or governance contract is the only strkey the app
 * reads from configuration, so nothing else is accepted.
 */
export function isValidContractId(value: string): boolean {
  // 33 payload bytes (version byte + 32-byte hash) + 2 checksum bytes = 35
  // bytes, which is 56 base32 characters.
  return value.length === 56 && isValidStrkey(value, CONTRACT_VERSION_BYTE);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Trims a variable, treating a blank one as unset. */
function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Shortened form of a value, for an error message. */
function preview(value: string): string {
  return value.length <= 64 ? `"${value}"` : `"${value.slice(0, 12)}…"`;
}

/** Reads the environment as Next.js sees it. */
export function readProcessEnv(): EnvInput {
  return {
    governanceContractId: process.env.NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID,
    tokenContractId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    networkPassphrase: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
    useFixture: process.env.NEXT_PUBLIC_USE_FIXTURE,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  };
}

/**
 * Validate the environment and return the configuration the app runs on.
 *
 * Throws `EnvError` listing every problem rather than the first, so one run
 * reports every value that needs fixing.
 */
export function loadEnv(input: EnvInput = readProcessEnv()): AppEnv {
  const problems: string[] = [];

  const fixtureFlag = clean(input.useFixture);
  if (fixtureFlag !== null && fixtureFlag !== "0" && fixtureFlag !== "1") {
    problems.push(`NEXT_PUBLIC_USE_FIXTURE must be "0" or "1", got ${preview(fixtureFlag)}`);
  }

  const governanceContractId = clean(input.governanceContractId);
  const tokenContractId = clean(input.tokenContractId);
  // A value that is present but wrong is always an error, even in fixture mode:
  // it is a copy-paste slip waiting to be read.
  for (const [name, value] of [
    ["NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID", governanceContractId],
    ["NEXT_PUBLIC_TOKEN_CONTRACT_ID", tokenContractId],
  ] as const) {
    if (value !== null && !isValidContractId(value)) {
      problems.push(
        `${name} must be a Stellar contract ID (a 56-character strkey starting with C), got ${preview(value)}`,
      );
    }
  }

  // Fixture mode stands in for a deployment, so a contract ID is only required
  // when the app means to read a real one. `USE_FIXTURE=0` is the deployment
  // setting that turns the dev convenience of an unset contract ID into a
  // startup failure. See "Frontend data source" in the README.
  const strict = fixtureFlag === "0";
  if (governanceContractId === null && strict) {
    problems.push(
      "NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID is required when NEXT_PUBLIC_USE_FIXTURE=0. Set it to the deployed governance contract.",
    );
  }

  const rpcUrl = clean(input.rpcUrl);
  if (rpcUrl !== null && !isValidHttpUrl(rpcUrl)) {
    problems.push(`NEXT_PUBLIC_STELLAR_RPC_URL must be an absolute http(s) URL, got ${preview(rpcUrl)}`);
  }

  const networkPassphrase = clean(input.networkPassphrase);
  if (networkPassphrase !== null && networkPassphrase.length < 2) {
    problems.push("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE is too short to be a network passphrase.");
  }

  const siteUrl = clean(input.siteUrl);
  if (siteUrl !== null && !isValidHttpUrl(siteUrl)) {
    problems.push(`NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL, got ${preview(siteUrl)}`);
  }

  if (problems.length > 0) {
    throw new EnvError(problems);
  }

  return {
    useFixture: fixtureFlag === "1" || (governanceContractId === null && !strict),
    governanceContractId,
    tokenContractId,
    stellarRpcUrl: rpcUrl ?? DEFAULT_RPC_URL,
    networkPassphrase: networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE,
    // A trailing slash would double up when the sitemap joins this to a path.
    siteUrl: (siteUrl ?? DEFAULT_SITE_URL).replace(/\/+$/, ""),
  };
}

let cached: AppEnv | null = null;

/**
 * The validated environment, validated once per process.
 *
 * `lib/config.ts` calls this at module scope, so a misconfigured deployment
 * fails on the first import rather than on the first contract read.
 */
export function getEnv(): AppEnv {
  cached ??= loadEnv();
  return cached;
}
