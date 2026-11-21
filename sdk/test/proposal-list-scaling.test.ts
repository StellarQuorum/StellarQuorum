import { jest } from '@jest/globals';
import { QuorumClient, TESTNET } from '../src/client';
import type { Proposal, QuorumClientConfig } from '../src/types';

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const VOTER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const RTT_MS = 5;

function makeProposal(id: bigint, status: Proposal['status'] = 'Active'): Proposal {
  return {
    id,
    proposer: VOTER,
    title: `Proposal ${id}`,
    description: 'Test',
    forVotes: 100n,
    againstVotes: 0n,
    abstainVotes: 0n,
    snapshotLedger: 1000,
    startLedger: 1001,
    endLedger: 2000,
    queueLedger: 0,
    quorumRequired: 50n,
    status,
    timelockPeriod: 0,
    executionGracePeriod: 0,
    metadataUri: '',
    kind: 'Executable',
  };
}

describe('getProposals() / getAllProposals() scaling (#450, #462)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('lists 50 proposals with a single get_proposals simulation instead of 51 reads (#450)', async () => {
    const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);
    const simSpy = jest
      .spyOn(client as unknown as { simulate: (...args: unknown[]) => Promise<unknown> }, 'simulate')
      .mockImplementation(async (method: unknown) => {
        expect(method).toBe('get_proposals');
        return Array.from({ length: 50 }, (_, i) => ({
          id: BigInt(i + 1),
          proposer: VOTER,
          title: `P${i + 1}`,
          description: 'Test',
          for_votes: 10n,
          against_votes: 0n,
          abstain_votes: 0n,
          snapshot_ledger: 100,
          start_ledger: 101,
          end_ledger: 200,
          queue_ledger: 0,
          quorum_required: 5n,
          status: ['Active'],
        }));
      });

    const proposals = await client.getProposals({ limit: 50 });

    expect(simSpy).toHaveBeenCalledTimes(1);
    expect(proposals).toHaveLength(50);
    expect(proposals[0].id).toBe(1n);
    expect(proposals[49].id).toBe(50n);
  });

  it('chunks getAllProposals at the 100-proposal contract cap (#450)', async () => {
    const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);
    let callIdx = 0;
    const simSpy = jest
      .spyOn(client as unknown as { simulate: (...args: unknown[]) => Promise<unknown> }, 'simulate')
      .mockImplementation(async () => {
        callIdx += 1;
        const start = (callIdx - 1) * 100 + 1;
        const count = callIdx <= 2 ? 100 : 0;
        return Array.from({ length: count }, (_, i) => ({
          id: BigInt(start + i),
          proposer: VOTER,
          title: `P${start + i}`,
          description: 'Test',
          for_votes: 10n,
          against_votes: 0n,
          abstain_votes: 0n,
          snapshot_ledger: 100,
          start_ledger: 101,
          end_ledger: 200,
          queue_ledger: 0,
          quorum_required: 5n,
          status: ['Active'],
        }));
      });

    const proposals = await client.getAllProposals();

    expect(simSpy).toHaveBeenCalledTimes(3); // 100 + 100 + 0 (EOF)
    expect(proposals).toHaveLength(200);
  });

  it('falls back to per-id reads when get_proposals is unavailable on older contracts (#450)', async () => {
    const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);
    jest
      .spyOn(client as unknown as { simulate: (...args: unknown[]) => Promise<unknown> }, 'simulate')
      .mockRejectedValue(new Error('Method get_proposals not found'));
    const count = jest.spyOn(client, 'getProposalCount').mockResolvedValue(10n);
    const read = jest.spyOn(client, 'getProposal').mockImplementation(async id => {
      await new Promise(resolve => setTimeout(resolve, RTT_MS));
      return makeProposal(id);
    });

    const pending = client.getAllProposals();
    await jest.advanceTimersByTimeAsync(RTT_MS);
    const proposals = await pending;

    expect(count).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(10);
    expect(proposals).toHaveLength(10);
  });

  it('getProposalsByStatus pages through sparse matches until limit is satisfied (#462)', async () => {
    const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeProposal(BigInt(i + 1), i === 99 ? 'Queued' : 'Failed'),
    );
    const page2 = Array.from({ length: 50 }, (_, i) =>
      makeProposal(BigInt(101 + i), i < 2 ? 'Queued' : 'Failed'),
    );

    const fetchSpy = jest
      .spyOn(client as unknown as { fetchProposalWindow: (o: number, l?: number) => Promise<Proposal[]> }, 'fetchProposalWindow')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const queued = await client.getProposalsByStatus('Queued', { limit: 3 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(queued.map(p => p.id)).toEqual([100n, 101n, 102n]);
  });
});
