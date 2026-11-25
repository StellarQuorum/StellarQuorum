import { Account, rpc } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import { QuorumClient, TESTNET } from '../src/client';
import type { QuorumClientConfig } from '../src/types';

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const GUARDIAN = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const NEW_GUARDIAN = 'GDZST3XVCDTUJ76ZAV2HA72KYDN4F37RUAMN5QXPJHX2W3UMMXDAN2X';
const getAccount = jest.spyOn(rpc.Server.prototype, 'getAccount');
const prepareTransaction = jest.spyOn(rpc.Server.prototype, 'prepareTransaction');
const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);

describe('buildUpdateGuardian', () => {
  beforeEach(() => {
    getAccount.mockResolvedValue(new Account(GUARDIAN, '123'));
    prepareTransaction.mockImplementation(async transaction => transaction as never);
  });
  afterEach(() => { getAccount.mockReset(); prepareTransaction.mockReset(); });

  it('builds signable XDR from the current guardian and the new guardian', async () => {
    const xdr = await client.buildUpdateGuardian(GUARDIAN, NEW_GUARDIAN);
    expect(xdr).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(getAccount).toHaveBeenCalledWith(GUARDIAN);
    expect(prepareTransaction).toHaveBeenCalledTimes(1);
  });

  it('pays the fee from the given source account when one is supplied', async () => {
    await client.buildUpdateGuardian(GUARDIAN, NEW_GUARDIAN, NEW_GUARDIAN);
    expect(getAccount).toHaveBeenCalledWith(NEW_GUARDIAN);
  });
});
