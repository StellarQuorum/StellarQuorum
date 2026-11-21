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
    timelockPeriod: 0, executionGracePeriod: 0, kind: 'Standard',
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

test('decodes the shared lifecycle phase fixture', async () => {
  returns(fixture.phase.xdr);
  expect(await client.getProposalPhase(7n)).toBe(fixture.phase.expected);
});

test('decodes the shared quorum progress fixture', async () => {
  returns(fixture.quorumProgress.xdr);
  expect(await client.getQuorumProgress(7n)).toBe(fixture.quorumProgress.expected);
});

test('decodes the shared delegation fixtures', async () => {
  returns(fixture.delegate.xdr);
  expect(await client.getDelegate(fixture.voter)).toBe(fixture.delegate.expected);
  returns(fixture.pastVotes.xdr);
  expect(await client.getPastVotes(fixture.voter, 123)).toBe(BigInt(fixture.pastVotes.expected));
});

test('decodes the shared governance stats fixture', async () => {
  returns(fixture.stats.xdr);
  const expected = fixture.stats.expected;
  expect(await client.getGovernanceStats()).toEqual({
    totalProposals: expected.total_proposals,
    activeProposals: expected.active_proposals,
    queuedProposals: expected.queued_proposals,
    executedProposals: expected.executed_proposals,
    failedProposals: expected.failed_proposals,
    cancelledProposals: expected.cancelled_proposals,
    expiredProposals: expected.expired_proposals,
    vetoedProposals: expected.vetoed_proposals,
  });
});
