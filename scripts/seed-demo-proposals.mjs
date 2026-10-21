#!/usr/bin/env node
/**
 * Seeds a Soroban network with demo governance proposals (issue #300).
 *
 * Manual QA — against a testnet, or the local quickstart network from
 * `docker-compose.yml` — otherwise starts from an empty governance contract,
 * so every reviewer and contributor has to create proposals by hand through
 * the UI. This script deploys the contracts (or reuses a deployment that
 * already exists), funds a few accounts and drives four proposals into one
 * state each: Queued, Failed, Executed and Active.
 *
 * Every run creates fresh data: new contracts, new accounts, new proposals.
 * Nothing is reused and nothing is cleaned up, so the script is meant for a
 * throwaway test network, never for a production one. The contract ids and
 * proposal ids printed at the end differ on every run. See CONTRIBUTING.md.
 *
 * Requirements:
 *   - Node 20+ and the SDK's dependencies installed: `cd sdk && npm ci`.
 *   - A Soroban RPC endpoint and a friendbot. The local quickstart network
 *     provides both.
 *   - The Stellar CLI (`stellar`) on PATH, unless an existing deployment is
 *     passed in through QUORUM_GOVERNANCE_CONTRACT.
 *   - Built contract WASM files, unless an existing deployment is used:
 *     `cd contracts && cargo build --target wasm32-unknown-unknown --release`.
 *
 * Usage:
 *   node scripts/seed-demo-proposals.mjs
 *
 * Environment:
 *   QUORUM_RPC_URL              Soroban RPC URL (default http://localhost:8000/soroban/rpc)
 *   QUORUM_FRIENDBOT_URL        Friendbot URL (default http://localhost:8000/friendbot)
 *   QUORUM_NETWORK_PASSPHRASE   Network passphrase (default: the standalone passphrase)
 *   QUORUM_WASM_DIR             Directory holding the built contract WASM files
 *   QUORUM_GOVERNANCE_CONTRACT  Governance contract to seed instead of deploying one
 *   QUORUM_TOKEN_CONTRACT       Token contract to use (read from the governance
 *                               contract's config when omitted)
 *   QUORUM_TOKEN_ADMIN_SECRET   Secret key of the token admin, needed to fund the
 *                               demo accounts when an existing deployment is used
 *   QUORUM_DEMO_VOTING_PERIOD   Voting period in ledgers (default 30)
 *   QUORUM_DEMO_TIMELOCK_PERIOD Timelock period in ledgers (default 2)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const RPC_URL = process.env.QUORUM_RPC_URL ?? "http://localhost:8000/soroban/rpc";
const FRIENDBOT_URL = process.env.QUORUM_FRIENDBOT_URL ?? "http://localhost:8000/friendbot";
const PASSPHRASE = process.env.QUORUM_NETWORK_PASSPHRASE ?? "Standalone Network ; February 2017";
const WASM_DIR =
  process.env.QUORUM_WASM_DIR ??
  path.join(REPO_ROOT, "contracts", "target", "wasm32-unknown-unknown", "release");
const EXISTING_GOVERNANCE = (process.env.QUORUM_GOVERNANCE_CONTRACT ?? "").trim();
const EXISTING_TOKEN = (process.env.QUORUM_TOKEN_CONTRACT ?? "").trim();
const TOKEN_ADMIN_SECRET = (process.env.QUORUM_TOKEN_ADMIN_SECRET ?? "").trim();

/** Quorum, in basis points of the total token supply. */
const QUORUM_BPS = 500;
/**
 * Voting period, in ledgers.
 *
 * Long enough to cast every demo vote on the proposals that are driven to a
 * final state, short enough that waiting the window out stays practical.
 */
const VOTING_PERIOD = Number(process.env.QUORUM_DEMO_VOTING_PERIOD ?? 30);
/** Timelock between finalizing a proposal and executing it, in ledgers. */
const TIMELOCK_PERIOD = Number(process.env.QUORUM_DEMO_TIMELOCK_PERIOD ?? 2);
/** How long a queued proposal stays executable, in ledgers. */
const EXECUTION_GRACE_PERIOD = 1_000;
/** Tokens a proposer must hold to open a proposal in a freshly deployed contract. */
const PROPOSAL_THRESHOLD = 100_000n;
/** Tokens minted at genesis and split between the demo accounts. */
const INITIAL_SUPPLY = 1_000_000n;
/** Tokens the two voters receive, so the tally is weighted but not unanimous. */
const BOB_SHARE = 300_000n;
const CAROL_SHARE = 200_000n;
/** Decimal places of the demo token. */
const TOKEN_DECIMALS = 7;

/** Vote choices, matching the `support` values the contract expects. */
const AGAINST = 0;
const FOR = 1;
const ABSTAIN = 2;

/**
 * Source account used for read-only simulations.
 *
 * Simulating a contract call still needs a source account to build the
 * transaction, but a simulation is never signed or submitted, so the all-zero
 * ed25519 account works and reads need no funded account.
 */
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** How long to wait for a transaction to be included in a ledger. */
const TX_TIMEOUT_MS = 120_000;
/** How long to wait for the network to reach a given ledger. */
const LEDGER_TIMEOUT_MS = 30 * 60_000;
/**
 * Longest voting period the script is willing to wait out when it is pointed
 * at an existing deployment. A contract configured with a production-length
 * voting period would keep the script waiting for days.
 */
const MAX_WAITABLE_VOTING_PERIOD = 200;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Finds the root directory of an installed package.
 *
 * The package's own `exports` map does not expose its `package.json`, so the
 * root is found by walking up from a resolved file until a manifest with a
 * matching name turns up.
 *
 * @param {string} startPath Path of a file inside the package.
 * @param {string} name Package name to look for.
 * @returns {{ dir: string, manifest: object } | null} The package root, or null.
 */
function findPackageRoot(startPath, name) {
  let dir = path.resolve(startPath);
  for (;;) {
    const manifestPath = path.join(dir, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.name === name) return { dir, manifest };
      } catch {
        // A malformed manifest further up the tree is not this package.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Loads `@stellar/stellar-sdk` from the workspace that declares it.
 *
 * The repository root has no dependencies of its own, so the SDK is resolved
 * from `sdk/`, where it is declared (`cd sdk && npm ci` installs it). The
 * ESM build is imported through its entry point: the package's CommonJS build
 * pulls in `uint8array-extras`, which is ESM-only, so `require()` of the
 * CommonJS entry fails while it is being loaded.
 *
 * @returns {Promise<object>} The Stellar SDK namespace.
 */
async function loadStellarSdk() {
  const searchPaths = [path.join(REPO_ROOT, "sdk"), REPO_ROOT];
  let resolved;
  try {
    resolved = require.resolve("@stellar/stellar-sdk", { paths: searchPaths });
  } catch {
    throw new Error(
      "@stellar/stellar-sdk is not installed. Run `cd sdk && npm ci` before running this script.",
    );
  }
  const found = findPackageRoot(path.dirname(resolved), "@stellar/stellar-sdk");
  if (!found) {
    throw new Error(`could not locate the @stellar/stellar-sdk package root from ${resolved}`);
  }
  const entry = found.manifest.exports?.["."]?.import ?? found.manifest.module ?? found.manifest.main;
  return import(pathToFileURL(path.resolve(found.dir, entry)).href);
}

const {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
} = await loadStellarSdk();

/**
 * Reads a contract id out of the Stellar CLI's output.
 *
 * The CLI prints the id on its own line on some versions and behind a
 * "Contract ID:" label on others, so every id in the output is collected and
 * the last one wins.
 *
 * @param {string} output Raw stdout of the CLI.
 * @returns {string | null} The contract id, or null if the output holds none.
 */
function parseContractId(output) {
  const matches = output.match(/\bC[A-Z2-7]{55}\b/g);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Deploys a contract WASM file with the Stellar CLI.
 *
 * The CLI is used for the deployment only: it uploads the WASM and creates the
 * contract in one step, and prints the resulting contract id.
 *
 * @param {string} wasmPath Path of the WASM file to deploy.
 * @param {string} sourceSecret Secret key that pays for the deployment.
 * @returns {string} The id of the deployed contract.
 */
function deployContract(wasmPath, sourceSecret) {
  const args = [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source-account",
    sourceSecret,
    "--rpc-url",
    RPC_URL,
    "--network-passphrase",
    PASSPHRASE,
  ];
  let stdout;
  try {
    stdout = execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`stellar contract deploy failed: ${String(detail).trim()}`);
  }
  const contractId = parseContractId(stdout);
  if (!contractId) {
    throw new Error(`could not read a contract id from the Stellar CLI output:\n${stdout.trim()}`);
  }
  return contractId;
}

/**
 * Funds an account through the friendbot.
 *
 * The friendbot refuses to fund an account that already exists, which is not
 * an error here: the account may have been funded by an earlier run.
 *
 * @param {object} server Soroban RPC server.
 * @param {string} address Account to fund.
 * @returns {Promise<void>}
 */
async function fundAccount(server, address) {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`cannot reach the friendbot at ${FRIENDBOT_URL}: ${error.message}`);
  }
  if (response.ok) return;

  try {
    await server.getAccount(address);
  } catch {
    throw new Error(
      `friendbot funding failed for ${address}: ${response.status} ${(await response.text()).trim()}`,
    );
  }
}

/**
 * Signs the authorization entries a contract asks for.
 *
 * Every call in this script is submitted by the account that has to authorize
 * it, so the RPC answers with source-account credentials and the transaction
 * signature is enough. If a contract asks for a signature from another
 * address, that address is signed here — but only if the script holds its key.
 *
 * @param {object} server Soroban RPC server.
 * @param {object[]} entries Authorization entries from the simulation.
 * @param {string} sourceAddress Address that signs the transaction.
 * @param {Map<string, object>} keypairs Known accounts, keyed by address.
 * @returns {Promise<object[]>} The authorization entries to submit.
 */
async function signAuthEntries(server, entries, sourceAddress, keypairs) {
  const signed = [];
  for (const entry of entries) {
    const credentials = entry.credentials;
    const type = credentials.type;
    if (type !== "sorobanCredentialsAddress" && type !== "sorobanCredentialsAddressV2") {
      // Source-account credentials need no signature of their own: the
      // transaction signature covers them.
      signed.push(entry);
      continue;
    }
    const addressCredentials = type === "sorobanCredentialsAddress" ? credentials.address : credentials.addressV2;
    const address = Address.fromScAddress(addressCredentials.address).toString();
    if (address === sourceAddress) {
      signed.push(entry);
      continue;
    }
    const signer = keypairs.get(address);
    if (!signer) {
      throw new Error(
        `the contract requires an authorization from ${address}, which this script does not control`,
      );
    }
    const ledger = await server.getLatestLedger();
    signed.push(await authorizeEntry(entry, signer, ledger.sequence + 100, PASSPHRASE, address));
  }
  return signed;
}

/**
 * Calls a contract method and waits for the transaction to be included.
 *
 * @param {object} server Soroban RPC server.
 * @param {object} contract Contract to call.
 * @param {string} method Contract method to call.
 * @param {object[]} args Method arguments, as ScVals.
 * @param {string} source Address that signs the transaction.
 * @param {Map<string, object>} keypairs Known accounts, keyed by address.
 * @returns {Promise<object>} The confirmed transaction.
 */
async function invoke(server, contract, method, args, source, keypairs) {
  const signer = keypairs.get(source);
  if (!signer) {
    throw new Error(`no key for ${source}`);
  }
  const account = await server.getAccount(source);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`simulation of ${method} failed: ${simulation.error}`);
  }
  simulation.result.auth = await signAuthEntries(server, simulation.result.auth, source, keypairs);

  const assembled = rpc.assembleTransaction(transaction, simulation).build();
  assembled.sign(signer);
  const response = await server.sendTransaction(assembled.toXDR());
  if (response.status !== "PENDING" && response.status !== "SUCCESS") {
    throw new Error(
      `the network rejected ${method}: ${response.status} ${
        response.errorResult ? JSON.stringify(response.errorResult) : ""
      }`.trim(),
    );
  }

  const deadline = Date.now() + TX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(response.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return result;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`${method} failed on chain (transaction ${response.hash})`);
    }
    await sleep(1_000);
  }
  throw new Error(`${method} was not included in a ledger within ${TX_TIMEOUT_MS}ms`);
}

/**
 * Calls a read-only contract method and decodes the result.
 *
 * Nothing is signed or submitted, so this costs no fee and needs no funded
 * account.
 *
 * @param {object} server Soroban RPC server.
 * @param {object} contract Contract to read from.
 * @param {string} method Contract method to call.
 * @param {object[]} [args] Method arguments, as ScVals.
 * @returns {Promise<*>} The decoded return value.
 */
async function read(server, contract, method, args = []) {
  const source = new Account(READ_ONLY_SOURCE, "0");
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`read of ${method} failed: ${simulation.error}`);
  }
  return scValToNative(simulation.result.retval);
}

/**
 * Waits until the network has closed the given ledger.
 *
 * @param {object} server Soroban RPC server.
 * @param {number} target Ledger the network has to reach.
 * @returns {Promise<number>} The ledger the network reached.
 */
async function waitForLedger(server, target) {
  const deadline = Date.now() + LEDGER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { sequence } = await server.getLatestLedger();
    if (sequence >= target) return sequence;
    await sleep(1_000);
  }
  throw new Error(`the network did not reach ledger ${target} within ${LEDGER_TIMEOUT_MS}ms`);
}

/**
 * Decodes the contract's unit-variant status.
 *
 * A Soroban unit variant encodes as a one-element vector, so the decoded
 * value is `["Active"]` rather than `"Active"`.
 *
 * @param {*} raw Decoded status.
 * @returns {string} The variant name.
 */
function decodeStatus(raw) {
  const name = Array.isArray(raw) ? raw[0] : raw;
  return String(name);
}

/**
 * Reads a proposal and returns its decoded state.
 *
 * @param {object} server Soroban RPC server.
 * @param {object} governance Governance contract.
 * @param {bigint} proposalId Proposal to read.
 * @returns {Promise<object>} The proposal.
 */
async function getProposal(server, governance, proposalId) {
  const proposal = await read(server, governance, "get_proposal", [
    nativeToScVal(proposalId, { type: "u64" }),
  ]);
  return { ...proposal, status: decodeStatus(proposal.status) };
}

/**
 * Reads the governance contract's configuration.
 *
 * @param {object} server Soroban RPC server.
 * @param {object} governance Governance contract.
 * @returns {Promise<object>} The decoded config.
 */
async function getConfig(server, governance) {
  return read(server, governance, "get_config");
}

async function main() {
  const server = new rpc.Server(RPC_URL, { allowHttp: true });

  console.log(`Seeding demo governance proposals on ${RPC_URL}`);
  console.log(`  network passphrase: ${PASSPHRASE}`);

  // ─── Accounts ────────────────────────────────────────────────────────────
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random();
  const keypairs = new Map([
    [alice.publicKey(), alice],
    [bob.publicKey(), bob],
    [carol.publicKey(), carol],
  ]);

  console.log("Funding demo accounts...");
  for (const account of [alice, bob, carol]) {
    await fundAccount(server, account.publicKey());
  }

  // ─── Contracts ───────────────────────────────────────────────────────────
  let tokenId = EXISTING_TOKEN;
  let governanceId = EXISTING_GOVERNANCE;
  let config;

  if (governanceId) {
    console.log(`Using the existing governance contract ${governanceId}`);
    config = await getConfig(server, new Contract(governanceId));
    if (!tokenId) {
      // The decoded config already carries the address as a string.
      tokenId = String(config.token);
      console.log(`  token contract (from the governance config): ${tokenId}`);
    }
    if (Number(config.voting_period) > MAX_WAITABLE_VOTING_PERIOD) {
      throw new Error(
        `the governance contract's voting period is ${config.voting_period} ledgers, which this script ` +
          `will not wait out (the limit is ${MAX_WAITABLE_VOTING_PERIOD}). Point the script at a contract ` +
          "with a short voting period, or leave QUORUM_GOVERNANCE_CONTRACT unset to deploy a fresh one.",
      );
    }
  } else {
    const tokenWasm = path.join(WASM_DIR, "quorum_token.wasm");
    const governanceWasm = path.join(WASM_DIR, "quorum_governance.wasm");
    for (const wasm of [tokenWasm, governanceWasm]) {
      if (!existsSync(wasm)) {
        throw new Error(
          `${wasm} is missing. Build the contracts first:\n` +
            "  cd contracts && cargo build --target wasm32-unknown-unknown --release",
        );
      }
    }

    console.log("Deploying the token contract...");
    tokenId = deployContract(tokenWasm, alice.secret());
    console.log(`  token contract: ${tokenId}`);

    console.log("Deploying the governance contract...");
    governanceId = deployContract(governanceWasm, alice.secret());
    console.log(`  governance contract: ${governanceId}`);
  }

  const token = new Contract(tokenId);
  const governance = new Contract(governanceId);

  // ─── Initialization and token distribution ───────────────────────────────
  if (!EXISTING_GOVERNANCE) {
    console.log("Initializing the token contract...");
    await invoke(
      server,
      token,
      "initialize",
      [
        new Address(alice.publicKey()).toScVal(),
        nativeToScVal("Quorum", { type: "string" }),
        nativeToScVal("QUORUM", { type: "string" }),
        nativeToScVal(TOKEN_DECIMALS, { type: "u32" }),
        nativeToScVal(INITIAL_SUPPLY, { type: "i128" }),
      ],
      alice.publicKey(),
      keypairs,
    );

    console.log("Initializing the governance contract...");
    await invoke(
      server,
      governance,
      "initialize",
      [
        new Address(alice.publicKey()).toScVal(),
        new Address(alice.publicKey()).toScVal(),
        new Address(tokenId).toScVal(),
        nativeToScVal(QUORUM_BPS, { type: "u32" }),
        nativeToScVal(VOTING_PERIOD, { type: "u32" }),
        nativeToScVal(TIMELOCK_PERIOD, { type: "u32" }),
        nativeToScVal(EXECUTION_GRACE_PERIOD, { type: "u32" }),
        nativeToScVal(PROPOSAL_THRESHOLD, { type: "i128" }),
      ],
      alice.publicKey(),
      keypairs,
    );
    config = await getConfig(server, governance);
  }

  console.log("Distributing voting power...");
  if (EXISTING_GOVERNANCE && !TOKEN_ADMIN_SECRET) {
    // The admin of an existing token holds the supply, so the demo accounts
    // can only be funded by minting, which needs the admin's key.
    console.warn(
      "  QUORUM_TOKEN_ADMIN_SECRET is not set, so the demo accounts are not funded.\n" +
        "  The proposals below may not reach quorum on an existing deployment.",
    );
  } else {
    if (EXISTING_GOVERNANCE) {
      const admin = Keypair.fromSecret(TOKEN_ADMIN_SECRET);
      keypairs.set(admin.publicKey(), admin);
      await invoke(
        server,
        token,
        "mint",
        [new Address(alice.publicKey()).toScVal(), nativeToScVal(INITIAL_SUPPLY, { type: "i128" })],
        admin.publicKey(),
        keypairs,
      );
    }
    for (const [voter, share] of [
      [bob, BOB_SHARE],
      [carol, CAROL_SHARE],
    ]) {
      await invoke(
        server,
        token,
        "transfer",
        [
          new Address(alice.publicKey()).toScVal(),
          new Address(voter.publicKey()).toScVal(),
          nativeToScVal(share, { type: "i128" }),
        ],
        alice.publicKey(),
        keypairs,
      );
    }
  }

  const proposerBalance = await read(server, token, "balance", [
    new Address(alice.publicKey()).toScVal(),
  ]);
  const threshold = BigInt(config.proposal_threshold);
  if (BigInt(proposerBalance) < threshold) {
    throw new Error(
      `the proposer holds ${proposerBalance} tokens, which is below the proposal threshold of ` +
        `${threshold}. Fund the account, or point the script at a deployment whose proposer already ` +
        "holds enough tokens.",
    );
  }

  // ─── Proposals ───────────────────────────────────────────────────────────
  /**
   * Opens a proposal as the proposer.
   *
   * @param {string} title Proposal title.
   * @param {string} description Proposal description.
   * @returns {Promise<bigint>} The id of the new proposal.
   */
  const createProposal = async (title, description) => {
    const before = BigInt(await read(server, governance, "get_proposal_count"));
    await invoke(
      server,
      governance,
      "create_proposal",
      [
        new Address(alice.publicKey()).toScVal(),
        nativeToScVal(title, { type: "string" }),
        nativeToScVal(description, { type: "string" }),
        nativeToScVal("ipfs://demo-proposal-metadata", { type: "string" }),
      ],
      alice.publicKey(),
      keypairs,
    );
    return before + 1n;
  };

  /**
   * Casts a vote.
   *
   * @param {object} voter Keypair of the voter.
   * @param {bigint} proposalId Proposal to vote on.
   * @param {number} support Vote choice.
   * @returns {Promise<void>}
   */
  const vote = async (voter, proposalId, support) => {
    await invoke(
      server,
      governance,
      "vote",
      [
        new Address(voter.publicKey()).toScVal(),
        nativeToScVal(proposalId, { type: "u64" }),
        nativeToScVal(support, { type: "u32" }),
      ],
      voter.publicKey(),
      keypairs,
    );
  };

  console.log("Creating proposals...");
  const queuedId = await createProposal(
    "Fund the community grants programme",
    "Allocate 100,000 QUORUM to the grants programme for the coming quarter.",
  );
  await vote(bob, queuedId, FOR);

  const failedId = await createProposal(
    "Raise the proposal threshold",
    "Raise the proposal threshold to 1,000,000 QUORUM. This proposal is expected to fail.",
  );
  await vote(carol, failedId, AGAINST);

  const executedId = await createProposal(
    "Enable delegation on the QUORUM token",
    "Let holders delegate their voting power to another account.",
  );
  await vote(bob, executedId, FOR);

  console.log(`Waiting for the voting windows to close (up to ${VOTING_PERIOD} ledgers)...`);
  const lastDriven = await getProposal(server, governance, executedId);
  await waitForLedger(server, lastDriven.end_ledger + 1);

  console.log("Finalizing proposals...");
  for (const proposalId of [queuedId, failedId, executedId]) {
    await invoke(
      server,
      governance,
      "finalize",
      [nativeToScVal(proposalId, { type: "u64" })],
      alice.publicKey(),
      keypairs,
    );
  }

  console.log("Waiting out the timelock...");
  const queued = await getProposal(server, governance, executedId);
  await waitForLedger(server, queued.queue_ledger);

  console.log("Executing the passing proposal...");
  await invoke(
    server,
    governance,
    "execute",
    [
      new Address(alice.publicKey()).toScVal(),
      nativeToScVal(executedId, { type: "u64" }),
    ],
    alice.publicKey(),
    keypairs,
  );

  // The proposal that is left open is created last, so its voting window is
  // still running when the script finishes.
  const activeId = await createProposal(
    "Publish the quarterly transparency report",
    "Publish the treasury and voting report for the quarter. This proposal is still open.",
  );
  const active = await getProposal(server, governance, activeId);
  await waitForLedger(server, active.start_ledger);
  await vote(bob, activeId, FOR);
  await vote(carol, activeId, ABSTAIN);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("");
  console.log("Seeded proposals");
  console.log("----------------");
  for (const proposalId of [queuedId, failedId, executedId, activeId]) {
    const proposal = await getProposal(server, governance, proposalId);
    console.log(
      `  #${proposal.id}  ${proposal.status.padEnd(9)} ${proposal.title}\n` +
        `      for ${proposal.for_votes} / against ${proposal.against_votes} / ` +
        `abstain ${proposal.abstain_votes} (quorum ${proposal.quorum_required})`,
    );
  }

  console.log("");
  console.log("Demo accounts (throwaway keys, generated on every run)");
  console.log("------------------------------------------------------");
  for (const [role, account] of [
    ["alice (proposer)", alice],
    ["bob   (voter)", bob],
    ["carol (voter)", carol],
  ]) {
    console.log(`  ${role}  ${account.publicKey()}`);
    console.log(`      secret  ${account.secret()}`);
  }

  console.log("");
  console.log("Add to .env.local to point the frontend at the seeded contracts:");
  console.log(`  NEXT_PUBLIC_GOVERNANCE_CONTRACT=${governanceId}`);
  console.log(`  NEXT_PUBLIC_TOKEN_CONTRACT=${tokenId}`);
  console.log("");
}

main().catch(error => {
  console.error("");
  console.error(`seed-demo-proposals: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
