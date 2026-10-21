# Tutorial: Decentralize Your Stellar DeFi Protocol with Quorum

This tutorial walks a Stellar DeFi team through handing protocol decisions to token holders with Quorum. By the end you will have:

- governance and QUORUM token contracts running on testnet,
- a Node.js script that reads proposals through `@quorum/sdk`,
- a browser flow that casts votes through Freighter,
- a proposal that calls a function on your protocol when it passes,
- a watcher that follows a proposal from vote to execution, and
- your own branded copy of the Quorum frontend.

Every step runs on **testnet** first. The [last section](#going-to-mainnet) lists what changes for mainnet.

If you are still deciding *whether* and *how* to move to on-chain governance, read the [Governance Adoption Playbook](governance-playbook.md) first. For the contract-side integration pattern in depth, see the [Protocol Integration Guide](protocol-integration-guide.md).

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install the SDK](#2-install-the-sdk)
3. [Configure the client](#3-configure-the-client)
4. [Read existing proposals](#4-read-existing-proposals)
5. [Cast a vote](#5-cast-a-vote)
6. [Create a proposal](#6-create-a-proposal)
7. [Monitor execution](#7-monitor-execution)
8. [Self-host the frontend](#8-self-host-the-frontend)
9. [Going to mainnet](#going-to-mainnet)

---

## 1. Prerequisites

| You need | Why | How to get it |
|---|---|---|
| **Node.js 18+** | The SDK and frontend | [nodejs.org](https://nodejs.org) — check with `node --version` |
| **Stellar CLI** | Deploying and invoking contracts | [Install guide](https://developers.stellar.org/docs/tools/cli/install-cli) — check with `stellar --version` |
| **Rust + `wasm32-unknown-unknown`** | Building the contracts (only if you deploy your own) | `rustup target add wasm32-unknown-unknown` |
| **A funded testnet account** | Paying fees, signing | `stellar keys generate admin --network testnet --fund` |
| **Freighter** | Signing votes in the browser | [freighter.app](https://www.freighter.app), switched to **Testnet** in its settings |
| **QUORUM tokens** | Voting power and the proposal threshold | Minted by the token admin (see below) |

### Testnet contracts

Quorum does not yet have an official shared testnet deployment (tracked on the [roadmap](../README.md#roadmap)). Until it does, deploy your own pair. It takes a few minutes and gives you admin control, which you will need to allowlist your protocol in [step 6](#6-create-a-proposal).

```bash
git clone https://github.com/StellarQuorum/StellarQuorum.git
cd StellarQuorum
npm run build:contracts

WASM=contracts/target/wasm32-unknown-unknown/release
ADMIN=$(stellar keys address admin)

# QUORUM token: 7 decimals, 10,000,000 QUORUM minted to the admin
TOKEN_ID=$(stellar contract deploy --wasm $WASM/quorum_token.wasm \
  --source admin --network testnet)
stellar contract invoke --id $TOKEN_ID --source admin --network testnet -- \
  initialize --admin $ADMIN --name Quorum --symbol QUORUM \
  --decimals 7 --initial_supply 100000000000000

# Governance: 5% quorum, ~24h voting, ~12h timelock, 50,000 QUORUM to propose
GOV_ID=$(stellar contract deploy --wasm $WASM/quorum_governance.wasm \
  --source admin --network testnet)
stellar contract invoke --id $GOV_ID --source admin --network testnet -- \
  initialize --admin $ADMIN --guardian $ADMIN --token $TOKEN_ID \
  --quorum_bps 500 --voting_period 17280 --timelock_period 8640 \
  --execution_grace_period 17280 --proposal_threshold 500000000000

echo "GOV_ID=$GOV_ID"
echo "TOKEN_ID=$TOKEN_ID"
```

Periods are in ledgers (about 5 seconds each). For a quick end-to-end run, use a short `--voting_period` and `--timelock_period` such as `60` (about 5 minutes) so you are not waiting a day between steps. [Governance Parameters](governance-parameters.md) explains how to choose production values, and [Deployment](deployment.md) covers the deployment process in more detail.

> `scripts/deploy.sh` does the same thing in one command, but its governance `initialize` call predates the `guardian` and `execution_grace_period` arguments. Use the commands above until the script is updated.

Record your contract IDs. You can inspect both on Stellar Expert:

| Contract | ID | Explorer |
|---|---|---|
| Governance | `$GOV_ID` | `https://stellar.expert/explorer/testnet/contract/$GOV_ID` |
| QUORUM token | `$TOKEN_ID` | `https://stellar.expert/explorer/testnet/contract/$TOKEN_ID` |

### Getting QUORUM tokens

Voting power is your balance **at the proposal's snapshot ledger**, so tokens must be in the wallet *before* a proposal is created. Send some to the Freighter account you will vote with:

```bash
VOTER=G...   # your Freighter address
stellar contract invoke --id $TOKEN_ID --source admin --network testnet -- \
  transfer --from $ADMIN --to $VOTER --amount 1000000000000   # 100,000 QUORUM
```

Fund that address with testnet XLM too (Freighter → *Fund with Friendbot*), since it pays the vote fee.

---

## 2. Install the SDK

Create a project for your integration scripts:

```bash
mkdir my-protocol-governance && cd my-protocol-governance
npm init -y
npm pkg set type=module
npm install @quorum/sdk
```

If you sign with Freighter in a browser app, also install the optional peer dependency:

```bash
npm install @stellar/freighter-api
```

The package ships both ESM and CommonJS builds:

```typescript
import { QuorumClient } from '@quorum/sdk';        // ESM / bundlers
const { QuorumClient } = require('@quorum/sdk');   // CommonJS
```

The Freighter helpers live behind a separate entry point, `@quorum/sdk/freighter`, so Node scripts that never sign in a browser never load the wallet code.

> **Working from a clone?** To test unreleased SDK changes, run `npm run build:sdk` in the Quorum repo and install with `npm install /path/to/StellarQuorum/sdk`.

---

## 3. Configure the client

`QuorumClient` needs an RPC URL, the network passphrase, and your contract IDs. The SDK exports presets for both networks:

```typescript
// quorum.ts
import { QuorumClient, TESTNET, MAINNET } from '@quorum/sdk';

const network = process.env.STELLAR_NETWORK === 'mainnet' ? MAINNET : TESTNET;

export const client = new QuorumClient({
  rpcUrl: process.env.STELLAR_RPC_URL ?? network.rpcUrl!,
  networkPassphrase: network.networkPassphrase!,
  governanceContractId: process.env.GOV_ID!,
  tokenContractId: process.env.TOKEN_ID,
});

export const networkPassphrase = network.networkPassphrase!;
```

| Preset | RPC URL | Passphrase |
|---|---|---|
| `TESTNET` | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| `MAINNET` | `https://soroban-rpc.stellar.org` | `Public Global Stellar Network ; September 2015` |

The passphrase must match the network the RPC serves. If it does not, every transaction fails signature verification. For production, use an RPC provider with an SLA rather than the public endpoint.

Optional settings worth knowing:

```typescript
new QuorumClient({
  // ...network settings as above
  requestTimeoutMs: 15_000,          // per RPC call
  readRetryAttempts: 2,              // reads retry with backoff, writes never do
  cache: { enabled: true, ttlMs: 5_000 },  // cache reads in memory
  batchSimulation: true,             // batch concurrent proposal reads into one HTTP call
});
```

Check the connection by reading the governance configuration:

```typescript
// check.ts
import { client } from './quorum.js';

const config = await client.getConfig();
console.log({
  token: config.token,
  quorum: `${config.quorumBps / 100}%`,
  votingPeriodLedgers: config.votingPeriod,
  timelockLedgers: config.timelockPeriod,
  proposalThreshold: config.proposalThreshold,
});
```

```bash
GOV_ID=C... TOKEN_ID=C... npx tsx check.ts
```

---

## 4. Read existing proposals

### List

```typescript
// list.ts
import { client } from './quorum.js';

const count = await client.getProposalCount();
console.log(`${count} proposals`);

// One page, oldest first: ids 1..20
const page = await client.getProposals({ offset: 0, limit: 20 });

// Everything (one RPC call per proposal; prefer pages for large DAOs)
const all = await client.getAllProposals();
```

Proposal IDs are `bigint`s and start at `1`. A single proposal:

```typescript
const proposal = await client.getProposal(1n);   // null if it does not exist
```

### Filter

```typescript
const active = await client.getProposalsByStatus('Active');
const queued = await client.getProposalsByStatus('Queued');

// Anything else is a plain array filter
const mine = all.filter(p => p.proposer === process.env.MY_ADDRESS);
```

`getProposalsByStatus` filters *after* pagination, so passing `{ limit }` filters only that page. Omit pagination when you need every match.

Statuses follow the lifecycle in the [README](../README.md#proposal-lifecycle): `Pending`, `Active`, `Passed`, `Failed`, `Queued`, `Executed`, `Cancelled`.

### Display

Proposal timing is stored in **ledgers**, and token amounts in **raw units** (7 decimals). Convert both before showing them:

```typescript
// display.ts
import type { Proposal } from '@quorum/sdk';
import { client } from './quorum.js';

const LEDGER_SECONDS = 5;
const decimals = await client.getTokenDecimals();
const latest = await client.getLatestLedger();

const fmt = (raw: bigint) =>
  (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });

const ledgerToDate = (ledger: number) =>
  new Date(Date.now() + (ledger - latest) * LEDGER_SECONDS * 1000);

function show(p: Proposal) {
  const turnout = p.forVotes + p.againstVotes + p.abstainVotes;
  console.log(`#${p.id} [${p.status}] ${p.title}`);
  console.log(`  For ${fmt(p.forVotes)} · Against ${fmt(p.againstVotes)} · Abstain ${fmt(p.abstainVotes)}`);
  console.log(`  Quorum ${fmt(turnout)} / ${fmt(p.quorumRequired)}`);
  console.log(`  Voting ends ~${ledgerToDate(p.endLedger).toLocaleString()}`);
}

for (const p of await client.getProposals({ limit: 20 })) show(p);
```

The ledger-to-date conversion is an estimate. Ledger close times vary slightly, so label the result "approximately".

---

## 5. Cast a vote

Voting is a browser flow. The SDK **builds** an unsigned transaction, Freighter **signs** it, and the SDK **submits** it and waits for confirmation:

```
client.buildVote()  →  signWithFreighter()  →  client.submitAndWait()
   unsigned XDR          signed XDR              confirmed on-chain
```

### Before the vote

Show voters their weight before they sign. Weight is the balance at the snapshot, not the current balance, and a voter with zero weight is rejected by the contract with `NoVotingPower`:

```typescript
import { getFreighterAddress } from '@quorum/sdk/freighter';

const voter = await getFreighterAddress();
const proposal = (await client.getProposal(proposalId))!;
const weight = await client.getVotingPower(voter, proposal.snapshotLedger);
const already = await client.hasVoted(proposalId, voter);
```

### The vote

```typescript
// vote.ts — runs in the browser (React, Next.js, Vite, ...)
import type { VoteSupport } from '@quorum/sdk';
import { parseGovernanceError, GovernanceError, TransactionFailedError } from '@quorum/sdk';
import {
  isFreighterAvailable,
  getFreighterAddress,
  signWithFreighter,
  FreighterError,
  FreighterErrorCode,
} from '@quorum/sdk/freighter';
import { client, networkPassphrase } from './quorum';

export async function castVote(proposalId: bigint, support: VoteSupport) {
  if (!(await isFreighterAvailable())) {
    throw new Error('Install Freighter to vote');
  }
  const voter = await getFreighterAddress();

  // 1. Build: simulates the call, so contract errors surface here, before signing
  const xdr = await client.buildVote(voter, proposalId, support); // 0 Against · 1 For · 2 Abstain

  // Optional: show the fee before the wallet prompt
  const { totalFee } = await client.estimateFees(xdr);
  console.log(`Network fee: ${Number(totalFee) / 1e7} XLM`);

  // 2. Sign
  const { signedXdr } = await signWithFreighter(xdr, { networkPassphrase });

  // 3. Submit and wait for the ledger to close
  const result = await client.submitAndWait(signedXdr);
  client.invalidateCache('getProposal', proposalId);
  return result.txHash;
}
```

### Handling failures

Each layer fails with its own error type, so the UI can explain what happened:

```typescript
try {
  await castVote(7n, 1);
} catch (e) {
  if (e instanceof FreighterError) {
    switch (e.code) {
      case FreighterErrorCode.NotInstalled:    /* show install link */ break;
      case FreighterErrorCode.Locked:          /* ask user to unlock */ break;
      case FreighterErrorCode.SigningRejected: /* user said no; do nothing */ break;
    }
  } else if (parseGovernanceError(e) === GovernanceError.AlreadyVoted) {
    // show "you already voted"
  } else if (e instanceof TransactionFailedError) {
    console.error('Rejected on-chain', e.transactionHash, e.message);
  } else {
    throw e;
  }
}
```

The full error list is in [`sdk/src/errors.ts`](../sdk/src/errors.ts) and mirrors the contract's `GovernanceError` codes.

### Delegation

Holders who will not vote themselves can delegate their weight to someone else without transferring tokens:

```typescript
const xdr = await client.buildDelegate(holder, delegateAddress);
// sign + submitAndWait as above; client.buildUndelegate(holder) reverses it
```

See [Delegate Program](delegate-program.md) for running a delegate program around this.

---

## 6. Create a proposal

A Quorum proposal can carry **one on-chain action**: a call to a function on an allowlisted contract, made by the governance contract when the proposal executes. That is how a vote changes your protocol, with no team member signing anything.

### 6.1 Make your protocol governable

`execute()` calls `target.function()` **with no arguments**, with the governance contract as the caller. So the pattern is:

1. Make the governance contract your protocol's admin (or the admin of the functions you want governed).
2. Expose zero-argument entry points that apply a change, and check the caller with `require_auth()`.

For changes that need a value, such as a new fee, stage the value first and let governance *apply* it:

```rust
// In your protocol contract
pub fn stage_fee(env: Env, proposer: Address, new_fee_bps: u32) {
    proposer.require_auth();
    env.storage().instance().set(&DataKey::PendingFee, &new_fee_bps);
}

/// Called by Quorum governance when a fee proposal executes.
pub fn apply_pending_fee(env: Env) {
    let governance: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    governance.require_auth();
    let fee: u32 = env.storage().instance().get(&DataKey::PendingFee).unwrap();
    env.storage().instance().set(&DataKey::FeeBps, &fee);
}
```

Name the staged value in the proposal description, so voters approve a specific number. A single function per proposal (for example `pause_market_x`, `apply_pending_fee`, `release_grant_42`) keeps every vote about one decision. The [Protocol Integration Guide](protocol-integration-guide.md) covers the admin hand-over in more depth.

### 6.2 Allowlist your protocol

Proposal actions may only target allowlisted contracts. The governance admin adds yours once:

```bash
PROTOCOL_ID=C...   # your protocol contract
stellar contract invoke --id $GOV_ID --source admin --network testnet -- \
  allow_target --target $PROTOCOL_ID

stellar contract invoke --id $GOV_ID --network testnet -- \
  is_target_allowed --target $PROTOCOL_ID     # → true
```

`execute()` checks the allowlist again, so removing a target with `disallow_target` blocks queued proposals that call it.

### 6.3 Submit the proposal

The proposer must hold at least `proposalThreshold` tokens (50,000 QUORUM with the parameters above). Write the description following the [Proposal Style Guide](proposal-style-guide.md). [Proposal Examples](proposal-examples.md) has templates for each category.

```bash
stellar contract invoke --id $GOV_ID --source proposer --network testnet -- \
  create_proposal \
  --proposer $(stellar keys address proposer) \
  --title "Raise swap fee to 0.35%" \
  --description "Applies the staged fee of 35 bps via apply_pending_fee(). Motivation: ..." \
  --metadata_uri "https://forum.myprotocol.xyz/t/fee-change/123"
# → returns the new proposal id, e.g. 1
```

`metadata_uri` points at the off-chain discussion. Pass `""` if there is none.

From an app, `client.buildCreateProposal(proposer, title, description)` returns signable XDR the same way `buildVote` does.

> **Known gap:** as of SDK `0.2.0`, `buildCreateProposal` does not pass the `metadata_uri` argument that the current contract requires, so simulation fails against a contract built from `main`. Use the CLI (or invoke `create_proposal` directly with `@stellar/stellar-sdk`) until the SDK catches up.

### 6.4 Attach the on-chain action

While the proposal is `Active`, the proposer attaches the call it will make:

```bash
stellar contract invoke --id $GOV_ID --source proposer --network testnet -- \
  set_proposal_action \
  --proposer $(stellar keys address proposer) \
  --proposal_id 1 \
  --target $PROTOCOL_ID \
  --function apply_pending_fee
```

Attach the action as early in the voting window as you can, so voters see what they are voting on. The contract emits a `proposal_action_set` event that indexers and the frontend can display.

A proposal with no action is a **signaling** proposal. It goes through the same vote, but there is nothing to execute.

---

## 7. Monitor execution

After the vote, a proposal moves through three transactions. Anyone can send the first two; the third needs an executor signature:

```
Active ──finalize()──▶ Queued ──(timelock)──▶ execute() ──▶ Executed
       └──────────────▶ Failed  (no quorum or majority Against)
```

During the timelock, the guardian can `veto` a malicious proposal. After the timelock, `execute()` must run within `execution_grace_period` ledgers or the proposal expires.

### 7.1 Listen for events

The SDK decodes every governance event into a typed object. Poll the RPC's `getEvents` with a cursor:

```typescript
// watch.ts
import { rpc } from '@stellar/stellar-sdk';
import { decodeEvents } from '@quorum/sdk';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const GOV_ID = process.env.GOV_ID!;

let { sequence: startLedger } = await server.getLatestLedger();
let cursor: string | undefined;

for (;;) {
  const page = await server.getEvents(
    cursor
      ? { cursor, filters: [{ type: 'contract', contractIds: [GOV_ID] }], limit: 100 }
      : { startLedger, filters: [{ type: 'contract', contractIds: [GOV_ID] }], limit: 100 },
  );

  for (const event of decodeEvents(page.events)) {
    switch (event.type) {
      case 'proposal_created':   console.log('New proposal', event); break;
      case 'vote_cast':          console.log(`Vote on #${event.proposalId}: ${event.support} × ${event.votingPower}`); break;
      case 'proposal_finalized': console.log(`#${event.id} finalized → ${event.status}`); break;
      case 'proposal_queued':    console.log(`#${event.id} executable after ledger ${event.queueLedger}`); break;
      case 'proposal_executed':  console.log(`#${event.id} executed ✅`); break;
      case 'proposal_cancelled': console.log(`#${event.id} cancelled`); break;
    }
  }

  cursor = page.cursor;
  await new Promise(r => setTimeout(r, 5_000));   // ~one ledger
}
```

`@stellar/stellar-sdk` is already installed as a dependency of `@quorum/sdk`. Unknown topics, such as `proposal_action_set`, decode to `null` and are skipped, so the watcher does not break when the contract adds events. Public RPC nodes keep only about a week of events, so persist anything you need for history.

Typical uses: post to your Discord when a proposal opens, alert the guardian multisig when something is queued, or trigger the executor (below).

### 7.2 Finalize, wait for the timelock, execute

A small keeper script can drive a passed proposal to execution. It signs with a local key, so it suits a server or CI job:

```typescript
// keeper.ts
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { client, networkPassphrase } from './quorum.js';

const keeper = Keypair.fromSecret(process.env.KEEPER_SECRET!);

async function send(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(keeper);
  return client.submitAndWait(tx.toXDR());
}

const id = BigInt(process.argv[2]);

// 1. Close voting (allowed once endLedger has passed)
await send(await client.buildFinalize(keeper.publicKey(), id));
const queued = await client.waitForProposalStatus(id, 'Queued').catch(async () => {
  const p = await client.getProposal(id, { bypassCache: true });
  throw new Error(`Proposal ended as ${p?.status}`);
});

// 2. Wait for the timelock
while ((await client.getLatestLedger({ bypassCache: true })) < queued.queueLedger) {
  await new Promise(r => setTimeout(r, 30_000));
}

// 3. Execute: governance calls target.function()
await send(await client.buildExecute(keeper.publicKey(), id));
await client.waitForProposalStatus(id, 'Executed');
console.log(`Proposal #${id} executed`);
```

```bash
GOV_ID=C... TOKEN_ID=C... KEEPER_SECRET=S... npx tsx keeper.ts 1
```

If `execute` fails, the proposal stays `Queued` and the error says why: `TimelockNotExpired`, `TargetNotAllowed`, `ExecutionExpired`, `NotExecutable` (a signaling proposal) or `ContractPaused`. Check the result on Stellar Expert using the transaction hash, and confirm the change on your protocol:

```bash
stellar contract invoke --id $PROTOCOL_ID --network testnet -- get_fee_bps
```

---

## 8. Self-host the frontend

The Quorum frontend is a Next.js app that reads straight from your governance contract. Forking it gives your community a voting portal with your own branding.

### 8.1 Fork and run

```bash
gh repo fork StellarQuorum/StellarQuorum --clone --fork-name myprotocol-governance
cd myprotocol-governance

npm run build:sdk                # the frontend depends on the local SDK
cd frontend && npm install
cp .env.example .env.local
```

Point it at your contracts in `frontend/.env.local`:

```bash
NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID=C...      # $GOV_ID
NEXT_PUBLIC_TOKEN_CONTRACT_ID=C...           # $TOKEN_ID
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_USE_FIXTURE=0                    # fail loudly instead of showing mock data
NEXT_PUBLIC_SITE_URL=https://gov.myprotocol.xyz
```

```bash
npm run dev    # http://localhost:3000
```

Every variable is validated at startup by `frontend/lib/env.ts`. A malformed contract ID or URL stops the app with a message naming the variable. With no contract ID and `NEXT_PUBLIC_USE_FIXTURE` unset, the app serves bundled mock proposals, which is handy for UI work offline.

> `scripts/deploy.sh` prints `NEXT_PUBLIC_GOVERNANCE_CONTRACT` / `NEXT_PUBLIC_TOKEN_CONTRACT`. The frontend reads the `..._ID` names shown above.

### 8.2 Customize

| What | Where |
|---|---|
| All UI text: site title, home page copy, button labels | `frontend/messages/en.json` |
| Colors, fonts, spacing | `frontend/app/globals.css` |
| Favicon and app icons | `frontend/app/icon.svg`, `frontend/app/favicon.ico`, `frontend/app/apple-icon.png`, `frontend/public/icon-*.png` |
| PWA name and theme color | `frontend/app/manifest.ts` |
| Footer and external links | `frontend/lib/links.ts` |
| Pages | `frontend/app/` (`proposals/`, `create/`, `delegation/`) |

For example, to rebrand the home page, edit the `metadata` and `home` keys in `en.json`:

```json
"metadata": { "title": "MyProtocol Governance", "description": "Token holders steer MyProtocol." },
"home": { "titleLead": "Community governance for", "titleAccent": "MyProtocol", ... }
```

Run the tests after changes. Snapshot tests catch unintended UI changes:

```bash
npm test                 # unit + snapshot tests
npm run test:update      # accept intended snapshot changes
npm run lint
```

### 8.3 Deploy

```bash
npm run build && npm start
```

Any Next.js host works, including Vercel, Netlify and a container behind your own proxy. Set the same `NEXT_PUBLIC_*` variables in the host's environment. They are baked in at build time, so rebuild after changing them.

To pull in upstream fixes later:

```bash
git remote add upstream https://github.com/StellarQuorum/StellarQuorum.git
git fetch upstream && git merge upstream/main
```

Keep branding changes in `messages/`, `globals.css` and the icon files where possible, so upstream merges stay conflict-free.

---

## Going to mainnet

When testnet has run a full proposal cycle cleanly:

1. **Choose real parameters.** Use the [Governance Parameters](governance-parameters.md) guide. Typical starting points are a 24–72h voting period, a 48h timelock, and a threshold high enough to deter spam.
2. **Secure the keys.** Make the guardian a multisig, and plan how the governance admin is handed over or retired. See [Admin Key Management](admin-key-management.md) and the [Security Model](security-model.md).
3. **Deploy** with `--network mainnet` and initialize as in [step 1](#testnet-contracts).
4. **Allowlist** only the protocol contracts governance should control.
5. **Hand over admin** of those contracts to `$GOV_ID`.
6. **Switch the client** to `MAINNET` and a production RPC, and set the frontend's `NEXT_PUBLIC_STELLAR_*` variables to match.
7. **Announce** the first proposal, and add your protocol to [ADOPTERS.md](../ADOPTERS.md).

If something goes wrong after launch, follow the [Incident Response](incident-response.md) runbook.

---

## Further reading

- [Architecture](architecture.md): contract design and data flow
- [Testnet Walkthrough](testnet-walkthrough.md): the voting flow from a user's point of view
- [SDK reference](../README.md#sdk-reference) and [`sdk/README.md`](../sdk/README.md)
- [FAQ](faq.md) and [Glossary](glossary.md)
- Questions: [GitHub Discussions](https://github.com/StellarQuorum/StellarQuorum/discussions)
