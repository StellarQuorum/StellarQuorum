import { jest } from '@jest/globals';
import { rpc, xdr } from '@stellar/stellar-sdk';
import { QuorumClient } from '../src/client';
import fixture from './fixtures/governance-reads.json';

const simulate = jest.spyOn(rpc.Server.prototype, 'simulateTransaction');
const client = new QuorumClient({
  rpcUrl: 'https://rpc.example.com', networkPassphrase: 'Test SDF Network ; September 2015',
  governanceContractId: fixture.contractId,
});
function returns(encoded: string) {
  simulate.mockResolvedValueOnce({ result: { retval: xdr.ScVal.fromXDR(encoded, 'base64') } } as rpc.Api.SimulateTransactionResponse);
}
afterEach(() => simulate.mockReset());
afterAll(() => simulate.mockRestore());

test('decodes the exact proposal fixture consumed by Python, without precision loss', async () => {
  returns(fixture.proposal.xdr);
  const expected = fixture.proposal.expected;
  expect(await client.getProposal(BigInt(expected.id))).toEqual({
    id: BigInt(expected.id), proposer: expected.proposer, title: expected.title, description: expected.description,
    forVotes: BigInt(expected.for_votes), againstVotes: BigInt(expected.against_votes), abstainVotes: BigInt(expected.abstain_votes),
    snapshotLedger: expected.snapshot_ledger, startLedger: expected.start_ledger, endLedger: expected.end_ledger,
    queueLedger: expected.queue_ledger, quorumRequired: BigInt(expected.quorum_required), status: expected.status,
    timelockPeriod: expected.timelock_period, executionGracePeriod: expected.execution_grace_period,
    metadataUri: expected.metadata_uri, kind: expected.kind,
  });
});

test('decodes the exact config fixture consumed by Python', async () => {
  returns(fixture.config.xdr);
  const expected = fixture.config.expected;
  expect(await client.getConfig()).toEqual({
    token: expected.token, quorumBps: expected.quorum_bps, votingPeriod: expected.voting_period,
    timelockPeriod: expected.timelock_period, proposalThreshold: BigInt(expected.proposal_threshold), admin: expected.admin,
    guardian: '', executionGracePeriod: 0, paused: false, proposalDeposit: 0n, proposerCooldown: 0,
  });
});

test.each(fixture.votes)('decodes the shared vote fixture as $expected', async vote => {
  returns(vote.xdr);
  expect(await client.getVote(7n, fixture.voter)).toBe(vote.expected);
});
