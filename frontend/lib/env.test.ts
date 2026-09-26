import {
  DEFAULT_NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  DEFAULT_SITE_URL,
  EnvError,
  isValidContractId,
  loadEnv,
  type EnvInput,
} from "./env";

// Issue #143: validation is only worth having if the checks are right in both
// directions. A validator that rejects a real contract ID, or accepts a
// transposed character, is worse than no validator — so the strkey check is
// pinned against real values and the messages are asserted to name the
// variable that needs fixing.

// Real strkeys, encoded by @stellar/stellar-base.
const GOVERNANCE = "CBX55KH5A2ONRB6QDJOQ6M7FSIXVTK5ZVCGP4DRSBLBKUZMTIXQBQNRR";
const TOKEN = "CDUBT6PUT4DSLK373GCPJXCMTLJLP5R7SLCTLWSVCCEDATAZ75Q42JM5";
const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

/** A valid environment: a contract deployment on testnet. */
function deployment(overrides: Partial<EnvInput> = {}): EnvInput {
  return {
    governanceContractId: GOVERNANCE,
    tokenContractId: TOKEN,
    rpcUrl: DEFAULT_RPC_URL,
    networkPassphrase: DEFAULT_NETWORK_PASSPHRASE,
    useFixture: "0",
    siteUrl: DEFAULT_SITE_URL,
    ...overrides,
  };
}

function problemsOf(input: EnvInput): readonly string[] {
  try {
    loadEnv(input);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
  throw new Error("expected loadEnv to reject this environment");
}

describe("isValidContractId", () => {
  it("accepts a real contract ID", () => {
    expect(isValidContractId(GOVERNANCE)).toBe(true);
    expect(isValidContractId(TOKEN)).toBe(true);
  });

  it("rejects a strkey of the wrong type", () => {
    // A G… account address is a valid strkey, but not a contract.
    expect(isValidContractId(ACCOUNT)).toBe(false);
  });

  it("rejects a truncated ID and a mistyped character", () => {
    expect(isValidContractId(GOVERNANCE.slice(0, 55))).toBe(false);
    expect(isValidContractId(GOVERNANCE.slice(0, 55) + "2")).toBe(false);
    // Same prefix, same length, two characters swapped: only the checksum can
    // tell that one apart from a real contract.
    const middle = 20;
    const transposed =
      GOVERNANCE.slice(0, middle) +
      GOVERNANCE[middle + 1] +
      GOVERNANCE[middle] +
      GOVERNANCE.slice(middle + 2);
    expect(transposed).toHaveLength(56);
    expect(isValidContractId(transposed)).toBe(false);
  });

  it("rejects values that are not base32 at all", () => {
    expect(isValidContractId("C".repeat(56))).toBe(false);
    expect(isValidContractId("CBX55KH5A2ONRB6QDJOQ6M7FSIXVTK5ZVCGP4DRSBLBKUZMTIXQBQNR0")).toBe(false);
    expect(isValidContractId("0x1234")).toBe(false);
    expect(isValidContractId("")).toBe(false);
  });

  it("rejects an ID padded with extra characters", () => {
    expect(isValidContractId(`${GOVERNANCE}AA`)).toBe(false);
  });
});

describe("loadEnv", () => {
  it("returns a validated deployment", () => {
    const env = loadEnv(deployment());

    expect(env).toEqual({
      useFixture: false,
      governanceContractId: GOVERNANCE,
      tokenContractId: TOKEN,
      stellarRpcUrl: DEFAULT_RPC_URL,
      networkPassphrase: DEFAULT_NETWORK_PASSPHRASE,
      siteUrl: DEFAULT_SITE_URL,
    });
  });

  it("falls back to the documented defaults and fixtures when nothing is set", () => {
    const env = loadEnv({});

    expect(env.useFixture).toBe(true);
    expect(env.governanceContractId).toBeNull();
    expect(env.stellarRpcUrl).toBe(DEFAULT_RPC_URL);
    expect(env.networkPassphrase).toBe(DEFAULT_NETWORK_PASSPHRASE);
    expect(env.siteUrl).toBe(DEFAULT_SITE_URL);
  });

  it("treats a blank value as unset", () => {
    const env = loadEnv(deployment({ tokenContractId: "   " }));

    expect(env.tokenContractId).toBeNull();
  });

  it("strips a trailing slash from the site URL", () => {
    expect(loadEnv(deployment({ siteUrl: "https://quorum.example.com/" })).siteUrl).toBe(
      "https://quorum.example.com",
    );
  });

  it("fails fast when a deployment has no governance contract", () => {
    const problems = problemsOf(deployment({ governanceContractId: undefined }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID is required/);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_USE_FIXTURE=0/);
  });

  it("names the variable behind a malformed contract ID", () => {
    const problems = problemsOf(deployment({ governanceContractId: "CDUBT6PUT4DSLK373GCPJXCMTLJLP5R7SLCTLWSVCCEDATAZ75Q42JM6" }));

    expect(problems[0]).toMatch(/NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID must be a Stellar contract ID/);
    expect(problems[0]).toMatch(/56-character strkey starting with C/);
  });

  it("names the variable behind a malformed token contract ID", () => {
    expect(problemsOf(deployment({ tokenContractId: ACCOUNT }))[0]).toMatch(
      /NEXT_PUBLIC_TOKEN_CONTRACT_ID must be a Stellar contract ID/,
    );
  });

  it("rejects an RPC URL that is not an absolute http(s) URL", () => {
    expect(problemsOf(deployment({ rpcUrl: "soroban-testnet.stellar.org" }))[0]).toMatch(
      /NEXT_PUBLIC_STELLAR_RPC_URL must be an absolute http\(s\) URL/,
    );
  });

  it("rejects a non-boolean fixture flag", () => {
    expect(problemsOf(deployment({ useFixture: "true" }))[0]).toMatch(
      /NEXT_PUBLIC_USE_FIXTURE must be "0" or "1"/,
    );
  });

  it("rejects a site URL that is not absolute", () => {
    expect(problemsOf(deployment({ siteUrl: "quorum.example.com" }))[0]).toMatch(
      /NEXT_PUBLIC_SITE_URL must be an absolute http\(s\) URL/,
    );
  });

  it("reports every problem at once, not just the first", () => {
    const problems = problemsOf({
      governanceContractId: "nope",
      rpcUrl: "nope",
      useFixture: "nope",
    });

    expect(problems).toHaveLength(3);
  });

  it("still validates a contract ID that is present but broken, in fixture mode", () => {
    expect(problemsOf({ useFixture: "1", governanceContractId: "0xdeadbeef" })[0]).toMatch(
      /NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID must be a Stellar contract ID/,
    );
  });

  it("serves fixtures when explicitly asked, contract ID or not", () => {
    expect(loadEnv({ useFixture: "1" }).useFixture).toBe(true);
    expect(loadEnv({ useFixture: "1", governanceContractId: GOVERNANCE }).useFixture).toBe(true);
  });

  it("fails with a message that names the file to fix", () => {
    expect(() => loadEnv(deployment({ rpcUrl: "nope" }))).toThrow(/frontend\/\.env\.example/);
    expect(() => loadEnv(deployment({ rpcUrl: "nope" }))).toThrow(/Invalid environment configuration/);
  });
});
