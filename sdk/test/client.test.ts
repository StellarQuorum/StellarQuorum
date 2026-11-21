import { Account, rpc, Transaction, Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import { QuorumClient, TESTNET } from '../src/client';
import type { QuorumClientConfig } from '../src/types';
import { enumVariant, structVal } from './xdr';

// Mocked RPC: every read goes through Server.simulateTransaction, so stubbing
// it lets us inspect the encoded call and feed back a contract return value.
const simulate = jest.spyOn(rpc.Server.prototype, 'simulateTransaction');

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const TOKEN = 'CABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMWJO7';
const VOTER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const FEE_PAYER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const client = new QuorumClient({
  ...TESTNET,
  governanceContractId: CONTRACT,
  tokenContractId: CONTRACT,
} as QuorumClientConfig);

function returns(retval: xdr.ScVal) {
  simulate.mockResolvedValueOnce({ result: { retval } } as unknown as rpc.Api.SimulateTransactionResponse);
}

function fails(error: string) {
  simulate.mockResolvedValueOnce({ error } as unknown as rpc.Api.SimulateTransactionResponse);
}

/** Method name and ScVal arguments of the contract call last sent to the RPC. */
function lastCall(): { method: string; args: xdr.ScVal[] } {
  return invoke(lastCallInvoke());
}

/** The contract call last sent to the RPC. */
function lastCallInvoke(): xdr.InvokeContractArgs {
  const tx = simulate.mock.calls.at(-1)![0] as Transaction;
  const func = (tx.operations[0] as { func: xdr.HostFunction }).func;
  if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('Expected contract invocation');
  return func.invokeContract;
}

function invoke(args: xdr.InvokeContractArgs): { method: string; args: xdr.ScVal[] } {
  return { method: args.functionName.toString(), args: args.args };
}

/** Contract the call last sent to the RPC was addressed to. */
function callAddress(): string {
  return Address.fromScAddress(lastCallInvoke().contractAddress).toString();
}

const proposalFields = {
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
  timelock_period: nativeToScVal(10, { type: 'u32' }),
  quorum_required: nativeToScVal(50n, { type: 'i128' }),
  status: enumVariant('Active'),
};
const proposalVal = structVal(proposalFields);

afterEach(() => simulate.mockReset());

describe('delegation', () => {
  it('reads the representative from governance', async () => {
    returns(new Address(TOKEN).toScVal());
    expect(await client.getDelegate(VOTER)).toBe(TOKEN);
    expect(callAddress()).toBe(CONTRACT);
    expect(lastCall().method).toBe('get_delegate');
    expect(lastCall().args.map(a => Address.fromScVal(a).toString())).toEqual([VOTER]);
  });

  it.each([false, true])('builds delegation/revocation with the holder separate from the fee payer (clear=%s)', async clear => {
    const getAccount = jest.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(FEE_PAYER, '0'));
    const prepare = jest.spyOn(rpc.Server.prototype, 'prepareTransaction').mockImplementation(async tx => tx as never);
    try {
      const encoded = clear
        ? await client.buildUndelegate(VOTER, FEE_PAYER)
        : await client.buildDelegate(VOTER, TOKEN, FEE_PAYER);
      const tx = prepare.mock.calls[0][0] as Transaction;
      expect(encoded).toBe(tx.toXDR());
      expect(tx.source).toBe(FEE_PAYER);
      expect(getAccount).toHaveBeenCalledWith(FEE_PAYER);
      const func = (tx.operations[0] as { func: xdr.HostFunction }).func;
      if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('Expected contract invocation');
      const call = func.invokeContract;
      expect(Address.fromScAddress(call.contractAddress).toString()).toBe(CONTRACT);
      expect(call.functionName.toString()).toBe(clear ? 'undelegate' : 'delegate');
      expect(call.args.map(a => Address.fromScVal(a).toString())).toEqual(clear ? [VOTER] : [VOTER, TOKEN]);
    } finally {
      getAccount.mockRestore();
      prepare.mockRestore();
    }
  });
});

describe('argument encoding', () => {
  it('get_proposal(id: u64)', async () => {
    returns(proposalVal);
    await client.getProposal(7n);

    const { method, args } = lastCall();
    expect(method).toBe('get_proposal');
    expect(args).toHaveLength(1);
    expect(args[0].type).toBe('scvU64');
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
    expect(args.map(a => a.type)).toEqual(['scvU64', 'scvAddress']);
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
      timelockPeriod: 10,
      executionGracePeriod: 0,
      metadataUri: '',
      kind: 'Executable',
    });
  });

  it('maps ProposalNotFound to null and rethrows other contract errors', async () => {
    fails('HostError: Error(Contract, #3)');
    expect(await client.getProposal(99n)).toBeNull();

    fails('HostError: Error(Contract, #2)');
    await expect(client.getProposal(1n)).rejects.toThrow('Error(Contract, #2)');
  });

  it('rejects a ProposalStatus variant the SDK does not know', async () => {
    returns(structVal({ ...proposalFields, status: enumVariant('Ghost') }));
    await expect(client.getProposal(7n)).rejects.toThrow('Unknown ProposalStatus variant: Ghost');
  });

  it.each(['Active', 'Failed', 'Queued', 'Executed', 'Cancelled', 'Expired', 'Vetoed'] as const)(
    'decodes ProposalStatus %s', async status => {
      returns(structVal({ ...proposalFields, status: enumVariant(status) }));
      await expect(client.getProposal(7n)).resolves.toMatchObject({ status });
    },
  );

  it('rejects an unknown ProposalKind variant', async () => {
    returns(structVal({ ...proposalFields, kind: enumVariant('Unknown') }));
    await expect(client.getProposal(7n)).rejects.toThrow('Unknown ProposalKind variant: Unknown');
  });

  it('decodes get_proposal_count as bigint', async () => {
    returns(nativeToScVal(4n, { type: 'u64' }));
    expect(await client.getProposalCount()).toBe(4n);
  });

  it('decodes ordered proposal actions, co-sponsors, and current allowlist state', async () => {
    const action = structVal({
      target: new Address(TOKEN).toScVal(),
      function: nativeToScVal('transfer', { type: 'symbol' }),
      args: xdr.ScVal.scvVec([nativeToScVal(42n, { type: 'i128' })]),
    });
    returns(xdr.ScVal.scvVec([action]));
    expect(await client.getProposalActions(7n)).toEqual([
      { targetContractId: TOKEN, functionName: 'transfer', args: [42n] },
    ]);
    expect(lastCall().method).toBe('get_proposal_actions');
    expect(scValToNative(lastCall().args[0])).toBe(7n);

    returns(xdr.ScVal.scvVec([new Address(VOTER).toScVal()]));
    await expect(client.getCosponsors(7n)).resolves.toEqual([VOTER]);
    expect(lastCall().method).toBe('get_cosponsors');

    returns(nativeToScVal(false, { type: 'bool' }));
    await expect(client.isTargetAllowed(TOKEN)).resolves.toBe(false);
    expect(lastCall().method).toBe('is_target_allowed');
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
      guardian: '',
      executionGracePeriod: 0,
      paused: false,
      proposalDeposit: 0n,
      proposerCooldown: 0,
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
  jest.spyOn(rpc.Server.prototype, 'getLatestLedger')
    .mockResolvedValueOnce({ sequence: 1234 } as rpc.Api.GetLatestLedgerResponse);
  expect(await client.getLatestLedger()).toBe(1234);
});

// The token is a separate contract from governance: these reads have to address
// it, and get_past_votes has to be given the snapshot ledger rather than the
// latest one, or the weight shown before signing is the wrong number.
describe('voting power', () => {
  it('caches delegated snapshots separately from raw balances and supports fresh reads', async () => {
    const scoped = new QuorumClient({
      ...TESTNET,
      governanceContractId: CONTRACT,
      tokenContractId: TOKEN,
      cache: { enabled: true },
    } as QuorumClientConfig);

    returns(nativeToScVal(250n, { type: 'i128' }));
    expect(await scoped.getVotingPower(VOTER, 999)).toBe(250n);
    expect(callAddress()).toBe(TOKEN);
    expect(lastCall().method).toBe('get_past_votes');
    expect(scValToNative(lastCall().args[1])).toBe(999);
    expect(await scoped.getVotingPower(VOTER, 999)).toBe(250n);
    expect(simulate).toHaveBeenCalledTimes(1);

    returns(nativeToScVal(7n, { type: 'i128' }));
    expect(await scoped.getPastBalance(VOTER, 999)).toBe(7n);
    expect(lastCall().method).toBe('get_past_balance');

    returns(nativeToScVal(400n, { type: 'i128' }));
    expect(await scoped.getVotingPower(VOTER, 1000)).toBe(400n);
    expect(lastCall().method).toBe('get_past_votes');
    expect(scValToNative(lastCall().args[1])).toBe(1000);
    expect(simulate).toHaveBeenCalledTimes(3);

    returns(nativeToScVal(300n, { type: 'i128' }));
    expect(await scoped.getVotingPower(VOTER, 999, { bypassCache: true })).toBe(300n);
    expect(await scoped.getVotingPower(VOTER, 999)).toBe(250n);

    returns(nativeToScVal(350n, { type: 'i128' }));
    expect(await scoped.getVotingPower(VOTER, 999, { invalidateCache: true })).toBe(350n);
    expect(await scoped.getVotingPower(VOTER, 999)).toBe(350n);
    expect(simulate).toHaveBeenCalledTimes(5);
  });

  it('getVotingPower encodes (voter, snapshot_ledger) against the token', async () => {
    returns(nativeToScVal(250n, { type: 'i128' }));
    expect(await client.getVotingPower(VOTER, 999)).toBe(250n);

    const { method, args } = lastCall();
    expect(method).toBe('get_past_votes');
    expect(args.map(a => a.type)).toEqual(['scvAddress', 'scvU32']);
    expect(Address.fromScVal(args[0]).toString()).toBe(VOTER);
    expect(scValToNative(args[1])).toBe(999);
  });

  it('reads the configured token contract, not the governance one', async () => {
    const scoped = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT, tokenContractId: TOKEN } as QuorumClientConfig);

    returns(nativeToScVal(0n, { type: 'i128' }));
    await scoped.getVotingPower(VOTER, 999);

    expect(callAddress()).toBe(TOKEN);
  });

  it('falls back to the governance config when no token id is configured', async () => {
    const scoped = new QuorumClient({
      ...TESTNET,
      governanceContractId: CONTRACT,
      tokenContractId: '',
    } as QuorumClientConfig);

    returns(structVal({
      token: new Address(TOKEN).toScVal(),
      quorum_bps: nativeToScVal(500, { type: 'u32' }),
      voting_period: nativeToScVal(17280, { type: 'u32' }),
      timelock_period: nativeToScVal(34560, { type: 'u32' }),
      proposal_threshold: nativeToScVal(1000n, { type: 'i128' }),
      admin: new Address(VOTER).toScVal(),
    }));
    returns(nativeToScVal(7n, { type: 'i128' }));
    expect(await scoped.getVotingPower(VOTER, 999)).toBe(7n);

    expect(callAddress()).toBe(TOKEN);
  });

  it('reports a zero snapshot balance as zero rather than an error', async () => {
    returns(nativeToScVal(0n, { type: 'i128' }));
    expect(await client.getVotingPower(VOTER, 999)).toBe(0n);
  });

  it('getBalance reads the live balance and getTokenDecimals the token scale', async () => {
    returns(nativeToScVal(400n, { type: 'i128' }));
    expect(await client.getBalance(VOTER)).toBe(400n);

    const balance = lastCall();
    expect(balance.method).toBe('balance');
    expect(balance.args.map(a => a.type)).toEqual(['scvAddress']);
    expect(Address.fromScVal(balance.args[0]).toString()).toBe(VOTER);

    returns(nativeToScVal(7, { type: 'u32' }));
    expect(await client.getTokenDecimals()).toBe(7);
    expect(lastCall()).toEqual({ method: 'decimals', args: [] });
  });

  it('surfaces a failed read instead of reporting zero power', async () => {
    fails('HostError: Error(Contract, #1)');
    await expect(client.getVotingPower(VOTER, 999)).rejects.toThrow('Error(Contract, #1)');
  });
});

describe('transaction builders', () => {
  it('buildExecute(source, id) sends source as the executor, then the proposal id', async () => {
    // Stub the account lookup and footprint assembly so the builder runs
    // offline and the unsigned transaction can be inspected.
    const getAccount = jest.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(VOTER, '0'));
    const prepare = jest.spyOn(rpc.Server.prototype, 'prepareTransaction').mockImplementation(async tx => tx as never);
    try {
      await client.buildExecute(VOTER, 5n);

      const tx = prepare.mock.calls[0][0] as Transaction;
      const func = (tx.operations[0] as { func: xdr.HostFunction }).func;
      if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('Expected contract invocation');
      const { method, args } = invoke(func.invokeContract);

      expect(method).toBe('execute');
      expect(args.map(a => a.type)).toEqual(['scvAddress', 'scvU64']);
      expect(Address.fromScVal(args[0]).toString()).toBe(VOTER);
      expect(scValToNative(args[1])).toBe(5n);
    } finally {
      getAccount.mockRestore();
      prepare.mockRestore();
    }
  });

  it.each([
    ['buildMarkExpired', 'mark_expired'],
    ['buildExtendProposalTtl', 'extend_proposal_ttl'],
  ] as const)('%s sends the explicit fee source and proposal id', async (builderName, method) => {
    const getAccount = jest.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(FEE_PAYER, '0'));
    const prepare = jest.spyOn(rpc.Server.prototype, 'prepareTransaction').mockImplementation(async tx => tx as never);
    try {
      await client[builderName](FEE_PAYER, 42n);
      const tx = prepare.mock.calls[0][0] as Transaction;
      const func = (tx.operations[0] as { func: xdr.HostFunction }).func;
      if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('Expected contract invocation');
      const invocation = invoke(func.invokeContract);

      expect(tx.source).toBe(FEE_PAYER);
      expect(invocation.method).toBe(method);
      expect(invocation.args).toHaveLength(1);
      expect(scValToNative(invocation.args[0])).toBe(42n);
    } finally {
      getAccount.mockRestore();
      prepare.mockRestore();
    }
  });
});

describe('contract versions', () => {
  it('reads both deployed versions and warns when either is outside the supported range', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    returns(nativeToScVal('0.2.0', { type: 'string' }));
    returns(structVal({
      token: new Address(TOKEN).toScVal(),
      quorum_bps: nativeToScVal(500, { type: 'u32' }),
      voting_period: nativeToScVal(100, { type: 'u32' }),
      timelock_period: nativeToScVal(10, { type: 'u32' }),
      proposal_threshold: nativeToScVal(1n, { type: 'i128' }),
      admin: new Address(VOTER).toScVal(),
    }));
    returns(nativeToScVal('0.1.0', { type: 'string' }));

    try {
      await expect(client.getContractVersions()).resolves.toEqual({ governance: '0.2.0', token: '0.1.0' });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('governance contract reports 0.2.0'));
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });
});

describe('governance and token history views', () => {
  const otherProposal = structVal({ ...proposalFields, id: nativeToScVal(8n, { type: 'u64' }), status: enumVariant('Queued') });

  it('get_proposals_by_proposer(proposer: Address) decodes every proposal in order', async () => {
    returns(xdr.ScVal.scvVec([proposalVal, otherProposal]));
    const proposals = await client.getProposalsByProposer(VOTER);

    expect(callAddress()).toBe(CONTRACT);
    const { method, args } = lastCall();
    expect(method).toBe('get_proposals_by_proposer');
    expect(args.map(a => a.type)).toEqual(['scvAddress']);
    expect(Address.fromScVal(args[0]).toString()).toBe(VOTER);
    expect(proposals.map(p => [p.id, p.status])).toEqual([[7n, 'Active'], [8n, 'Queued']]);
    expect(proposals[0]).toEqual({
      id: 7n, proposer: VOTER, title: 'Raise quorum', description: 'Details',
      forVotes: 100n, againstVotes: 20n, abstainVotes: 5n,
      snapshotLedger: 999, startLedger: 1000, endLedger: 2000, queueLedger: 0,
      quorumRequired: 50n, status: 'Active', timelockPeriod: 10, executionGracePeriod: 0,
      metadataUri: '', kind: 'Executable',
    });
  });

  it('get_proposals_by_proposer returns an empty list for a proposer with no proposals', async () => {
    returns(xdr.ScVal.scvVec([]));
    expect(await client.getProposalsByProposer(VOTER)).toEqual([]);
    expect(lastCall().method).toBe('get_proposals_by_proposer');
  });

  it('reads stake amount and unlock ledger from the token contract', async () => {
    returns(structVal({
      ledger: nativeToScVal(100, { type: 'u32' }),
      amount: nativeToScVal(1_000n, { type: 'i128' }),
      unlock_ledger: nativeToScVal(200, { type: 'u32' }),
    }));
    await expect(client.getStake(VOTER)).resolves.toEqual({ ledger: 100, amount: 1_000n, unlockLedger: 200 });
    expect(callAddress()).toBe(CONTRACT);
    expect(lastCall().method).toBe('get_stake');
  });

  it('previews boost using the contract view that accounts for the first ledger delay', async () => {
    returns(nativeToScVal(999n, { type: 'i128' }));
    await expect(client.previewStakeBoost(1_000n, 365 * 17_280)).resolves.toBe(999n);
    expect(callAddress()).toBe(CONTRACT);
    expect(lastCall().method).toBe('preview_stake_boost');
    expect(scValToNative(lastCall().args[0])).toBe(1_000n);
    expect(scValToNative(lastCall().args[1])).toBe(365 * 17_280);
  });

  it('get_proposals_by_proposer reuses the read cache per proposer', async () => {
    const scoped = new QuorumClient({
      ...TESTNET,
      governanceContractId: CONTRACT,
      tokenContractId: TOKEN,
      cache: { enabled: true },
    } as QuorumClientConfig);

    returns(xdr.ScVal.scvVec([proposalVal]));
    expect(await scoped.getProposalsByProposer(VOTER)).toHaveLength(1);
    expect(await scoped.getProposalsByProposer(VOTER)).toHaveLength(1);
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it('get_past_total_supply(ledger: u32) reads the token contract at that ledger', async () => {
    returns(nativeToScVal(5000n, { type: 'i128' }));
    expect(await client.getPastTotalSupply(999)).toBe(5000n);

    expect(callAddress()).toBe(CONTRACT);
    const { method, args } = lastCall();
    expect(method).toBe('get_past_total_supply');
    expect(args.map(a => a.type)).toEqual(['scvU32']);
    expect(scValToNative(args[0])).toBe(999);
  });

  it('get_past_total_supply is cached per ledger', async () => {
    const scoped = new QuorumClient({
      ...TESTNET,
      governanceContractId: CONTRACT,
      tokenContractId: TOKEN,
      cache: { enabled: true },
    } as QuorumClientConfig);

    returns(nativeToScVal(5000n, { type: 'i128' }));
    expect(await scoped.getPastTotalSupply(999)).toBe(5000n);
    expect(await scoped.getPastTotalSupply(999)).toBe(5000n);
    expect(simulate).toHaveBeenCalledTimes(1);

    returns(nativeToScVal(6000n, { type: 'i128' }));
    expect(await scoped.getPastTotalSupply(1000)).toBe(6000n);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(scValToNative(lastCall().args[0])).toBe(1000);
  });
});

describe('proposal veto history', () => {
  it('finds the veto event in the proposal timelock window and returns its guardian and reason', async () => {
    const guardian = VOTER;
    returns(structVal({
      ...proposalFields,
      status: enumVariant('Vetoed'),
      queue_ledger: nativeToScVal(1010, { type: 'u32' }),
    }));
    const getEvents = jest.spyOn(rpc.Server.prototype, 'getEvents').mockResolvedValue({
      events: [{
        topic: [
          nativeToScVal('proposal_vetoed', { type: 'symbol' }),
          nativeToScVal(7n, { type: 'u64' }),
        ],
        value: structVal({
          id: nativeToScVal(7n, { type: 'u64' }),
          guardian: new Address(guardian).toScVal(),
          reason: nativeToScVal('Treasury review is incomplete', { type: 'string' }),
        }),
      }],
    } as unknown as rpc.Api.GetEventsResponse);

    try {
      await expect(client.getProposalVetoEvent(7n)).resolves.toMatchObject({
        type: 'proposal_vetoed',
        id: 7n,
        guardian,
        reason: 'Treasury review is incomplete',
      });
      expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({
        startLedger: 1000,
        endLedger: 1009,
        filters: [expect.objectContaining({
          type: 'contract',
          contractIds: [CONTRACT],
          topics: [[
            nativeToScVal('proposal_vetoed', { type: 'symbol' }).toXDR('base64'),
            nativeToScVal(7n, { type: 'u64' }).toXDR('base64'),
          ]],
        })],
      }));
    } finally {
      getEvents.mockRestore();
    }
  });
});
