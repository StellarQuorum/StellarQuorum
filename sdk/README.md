# @quorum/sdk

TypeScript SDK for the Quorum governance protocol on Stellar/Soroban: read
proposals and config through `QuorumClient`, build transactions, sign them
with Freighter, and decode the events both contracts emit.

```bash
npm install @quorum/sdk
```

## Usage

```typescript
import { QuorumClient, TESTNET, decodeEvents } from '@quorum/sdk';

const client = new QuorumClient({
  ...TESTNET,
  governanceContractId: 'CC...',
  tokenContractId: 'CC...',
});

await client.getProposal(1n);
await client.getAllProposals();
await client.getConfig();
```

Both module systems are supported — `import` resolves the ESM build,
`require()` the CommonJS build, and TypeScript picks up the matching types.

### Signing with Freighter

The wallet helper lives behind an optional entry point so Node consumers never
load it. It requires the peer dependency:

```bash
npm install @stellar/freighter-api
```

```typescript
import { signWithFreighter, FreighterError, FreighterErrorCode } from '@quorum/sdk/freighter';

const xdr = await client.buildVote(voter, proposalId, 1);
const { signedXdr } = await signWithFreighter(xdr, { networkPassphrase });
```

Every failure is a `FreighterError` with a `code` — `NOT_INSTALLED`,
`LOCKED`, `ACCESS_DENIED`, `SIGNING_REJECTED` or `WALLET_ERROR`.

### Events

```typescript
import { decodeEvent, decodeEvents } from '@quorum/sdk';

for (const event of decodeEvents(rpcEvents)) {
  if (event.type === 'vote_cast') console.log(event.proposalId, event.votingPower);
}
```

Covers `proposal_created`, `vote_cast`, `proposal_finalized`,
`proposal_queued`, `proposal_executed`, `proposal_cancelled`, `transfer`,
`mint`, `burn`, `approve` and `admin_transferred`. Unknown topics decode to
`null` instead of throwing.

## Contract errors

`GovernanceError` and `TokenError` mirror the Rust `#[contracterror]` enums;
`parseGovernanceError(error)` maps `Error(Contract, #N)` to a code.

## Releasing

See [docs/publishing.md](https://github.com/StellarQuorum/StellarQuorum/blob/main/docs/publishing.md)
for the versioning policy and release checklist.

## License

MIT
