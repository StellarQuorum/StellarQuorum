import type { QuorumClient } from "@quorum/sdk";
import { getEnv } from "./env";

// Issue #143: the environment is validated once, here, at module scope — so a
// missing or malformed contract ID or RPC URL fails on the first import with a
// message naming the variable, instead of as a decoding error from inside the
// SDK on the first read.
const env = getEnv();

/**
 * Fixture mode — bundled mock data instead of a contract — is decided here so
 * the server data layer and the client components can never disagree about
 * which source they are reading. See "Frontend data source" in the README.
 */
export const USE_FIXTURE = env.useFixture;

/**
 * Decimals used to render raw token units as amounts.
 *
 * The deployed token contract is the authority, so a live network reads
 * `decimals()` through the SDK. This is the fallback for fixture mode and for a
 * failed read, and matches the token deployed by scripts/deploy.sh.
 */
export const TOKEN_DECIMALS = 7;

/** A QuorumClient pointed at the configured network. */
export async function createQuorumClient(): Promise<QuorumClient> {
  // Imported lazily so fixture mode (and its tests) never load the Stellar SDK.
  const { QuorumClient, TESTNET } = await import("@quorum/sdk");
  return new QuorumClient({
    rpcUrl: env.stellarRpcUrl || TESTNET.rpcUrl!,
    networkPassphrase: env.networkPassphrase || TESTNET.networkPassphrase!,
    // Validated in loadEnv, so this is a contract ID or nothing.
    governanceContractId: env.governanceContractId!,
    tokenContractId: env.tokenContractId ?? "",
  });
}
