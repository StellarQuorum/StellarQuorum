import { SorobanRpc, Transaction, Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { QuorumClient, TESTNET } from '../src/client';
import type { QuorumClientConfig } from '../src/types';
import { enumVariant, structVal } from './xdr';

// Mocked RPC: every read goes through Server.simulateTransaction, so stubbing
// it lets us inspect the encoded call and feed back a contract return value.
const simulate = jest.spyOn(SorobanRpc.Server.prototype, 'simulateTransaction');

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const VOTER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const client = new QuorumClient({
  ...TESTNET,
  governanceContractId: CONTRACT,
  tokenContractId: CONTRACT,
} as QuorumClientConfig);

function returns(retval: xdr.ScVal) {
  simulate.mockResolvedValueOnce({ result: { retval } } as unknown as SorobanRpc.Api.SimulateTransactionResponse);
}

function fails(error: string) {
  simulate.mockResolvedValueOnce({ error } as unknown as SorobanRpc.Api.SimulateTransactionResponse);
}

/** Method name and ScVal arguments of the contract call last sent to the RPC. */
function lastCall(): { method: string; args: xdr.ScVal[] } {
  const tx = simulate.mock.calls.at(-1)![0] as Transaction;
  const op = tx.operations[0] as { func: xdr.HostFunction };
  const invoke = op.func.invokeContract();
  return { method: invoke.functionName().toString(), args: invoke.args() };
}

const proposalVal = structVal({
  id: nativeToScVal(7n, { type: 'u64' }),
  proposer: new Address(VOTER).toScVal(),
  title: nativeToScVal('Raise quorum', { type: 'string' }),
  description: nativeToScVal('Details', { type: 'string' }),
  for_votes: nativeToScVal(100n, { type: 'i128' }),
  against_votes: nativeToScVal(20n, { type: 'i128' }),
  abstain_votes: nativeToScVal(5n, { type: 'i128' }),
  snapshot_ledger: nativeToScVal(999, { type: 'u32' }),
  start_ledger: nativeToScVal(1000, { type: 'u32' }),
  end_ledger: nativeToScVal(2000, { type: 'u32' }),
  queue_ledger: nativeToScVal(0, { type: 'u32' }),
  quorum_required: nativeToScVal(50n, { type: 'i128' }),
  status: enumVariant('Active'),
});

afterEach(() => simulate.mockReset());

describe('argument encoding', () => {
  it('get_proposal(id: u64)', async () => {
    returns(proposalVal);
    await client.getProposal(7n);

    const { method, args } = lastCall();
    expect(method).toBe('get_proposal');
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(scValToNative(args[0])).toBe(7n);
  });

  it('get_proposal_count() and get_config() take no arguments', async () => {
    returns(nativeToScVal(0n, { type: 'u64' }));
    await client.getProposalCount();
    expect(lastCall()).toEqual({ method: 'get_proposal_count', args: [] });
  });

  it('get_vote(proposal_id: u64, voter: Address)', async () => {
    returns(xdr.ScVal.scvVoid());
    await client.getVote(3n, VOTER);

    const { method, args } = lastCall();
    expect(method).toBe('get_vote');
    expect(args.map(a => a.switch())).toEqual([xdr.ScValType.scvU64(), xdr.ScValType.scvAddress()]);
    expect(Address.fromScVal(args[1]).toString()).toBe(VOTER);
  });
});

describe('result decoding', () => {
  it('decodes Proposal into camelCase with bigint amounts and a status string', async () => {
    returns(proposalVal);
    expect(await client.getProposal(7n)).toEqual({
      id: 7n,
      proposer: VOTER,
      title: 'Raise quorum',
      description: 'Details',
      forVotes: 100n,
      againstVotes: 20n,
      abstainVotes: 5n,
      snapshotLedger: 999,
      startLedger: 1000,
      endLedger: 2000,
      queueLedger: 0,
      quorumRequired: 50n,
      status: 'Active',
    });
  });

  it('maps ProposalNotFound to null and rethrows other contract errors', async () => {
    fails('HostError: Error(Contract, #3)');
    expect(await client.getProposal(99n)).toBeNull();

    fails('HostError: Error(Contract, #2)');
    await expect(client.getProposal(1n)).rejects.toThrow('Error(Contract, #2)');
  });

  it('decodes get_proposal_count as bigint', async () => {
    returns(nativeToScVal(4n, { type: 'u64' }));
    expect(await client.getProposalCount()).toBe(4n);
  });

  it('decodes Config', async () => {
    returns(structVal({
      token: new Address(CONTRACT).toScVal(),
      quorum_bps: nativeToScVal(500, { type: 'u32' }),
      voting_period: nativeToScVal(17280, { type: 'u32' }),
      timelock_period: nativeToScVal(34560, { type: 'u32' }),
      proposal_threshold: nativeToScVal(1000n, { type: 'i128' }),
      admin: new Address(VOTER).toScVal(),
    }));
    expect(await client.getConfig()).toEqual({
      token: CONTRACT,
      quorumBps: 500,
      votingPeriod: 17280,
      timelockPeriod: 34560,
      proposalThreshold: 1000n,
      admin: VOTER,
    });
  });

  it('decodes get_vote Option<u32>', async () => {
    returns(nativeToScVal(1, { type: 'u32' }));
    expect(await client.getVote(1n, VOTER)).toBe(1);
    returns(xdr.ScVal.scvVoid());
    expect(await client.getVote(1n, VOTER)).toBeNull();
  });
});

it('getLatestLedger returns the RPC sequence', async () => {
  jest.spyOn(SorobanRpc.Server.prototype, 'getLatestLedger')
    .mockResolvedValueOnce({ sequence: 1234 } as SorobanRpc.Api.GetLatestLedgerResponse);
  expect(await client.getLatestLedger()).toBe(1234);
});
