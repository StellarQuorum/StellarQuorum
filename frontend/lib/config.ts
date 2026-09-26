import type { QuorumClient } from "@quorum/sdk";

/**
 * Runtime configuration derived from the environment.
 *
 * Fixture mode — bundled mock data instead of a contract — is decided here so
 * the server data layer and the client components can never disagree about
 * which source they are reading. See "Frontend data source" in the README.
 */
export const USE_FIXTURE =
  process.env.NEXT_PUBLIC_USE_FIXTURE === "1" || !process.env.NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID;

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
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? TESTNET.rpcUrl!,
    networkPassphrase: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? TESTNET.networkPassphrase!,
    governanceContractId: process.env.NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID!,
    tokenContractId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "",
  });
}
