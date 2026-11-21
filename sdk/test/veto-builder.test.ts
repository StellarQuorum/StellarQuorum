import { Account, rpc } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import { QuorumClient, TESTNET } from '../src/client';
import { GovernanceContractError } from '../src/errors';
import type { QuorumClientConfig } from '../src/types';

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const GUARDIAN = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const getAccount = jest.spyOn(rpc.Server.prototype, 'getAccount');
const prepareTransaction = jest.spyOn(rpc.Server.prototype, 'prepareTransaction');
const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);

describe('buildVeto (#453)', () => {
  beforeEach(() => {
    getAccount.mockResolvedValue(new Account(GUARDIAN, '123'));
    prepareTransaction.mockImplementation(async transaction => transaction as never);
  });
  afterEach(() => { getAccount.mockReset(); prepareTransaction.mockReset(); });

  it('builds signable XDR from the guardian, proposal id, and reason', async () => {
    const xdr = await client.buildVeto(GUARDIAN, 12n, 'Security issue');
    expect(xdr).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(getAccount).toHaveBeenCalledWith(GUARDIAN);
    expect(prepareTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [24, 'EmptyVetoReason'],
    [25, 'VetoReasonTooLong'],
    [26, 'VetoWindowClosed'],
  ])('surfaces typed veto contract error %s', async (code, name) => {
    const { mapGovernanceSimulationError } = await import('../src/client');
    const error = mapGovernanceSimulationError('veto', new Error(`HostError: Error(Contract, #${code})`));
    expect(error).toBeInstanceOf(GovernanceContractError);
    expect((error as GovernanceContractError).code).toBe(code);
    expect(error.message).toContain(name === 'EmptyVetoReason' ? 'veto reason' : name === 'VetoReasonTooLong' ? 'too long' : 'window has closed');
  });
});
