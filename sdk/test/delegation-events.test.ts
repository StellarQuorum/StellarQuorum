import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import { QuorumClient, TESTNET } from '../src/client';
import { structVal } from './xdr';
import type { QuorumClientConfig } from '../src/types';

const CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const USER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const OTHER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const latest = jest.spyOn(rpc.Server.prototype, 'getLatestLedger');
const getEvents = jest.spyOn(rpc.Server.prototype, 'getEvents');
const client = new QuorumClient({ ...TESTNET, governanceContractId: CONTRACT } as QuorumClientConfig);

afterEach(() => { latest.mockReset(); getEvents.mockReset(); });

it('reads and filters delegation changes for the connected delegator', async () => {
  latest.mockResolvedValue({ sequence: 200_000 } as never);
  getEvents.mockResolvedValue({ events: [
    {
      id: '200000-1-1', ledger: 200_000,
      topic: [xdr.ScVal.scvSymbol('delegated')],
      value: structVal({ delegator: new Address(USER).toScVal(), delegatee: new Address(OTHER).toScVal() }),
    },
    {
      id: '199999-1-1', ledger: 199_999,
      topic: [xdr.ScVal.scvSymbol('delegated')],
      value: structVal({ delegator: new Address(OTHER).toScVal(), delegatee: new Address(USER).toScVal() }),
    },
  ] } as never);
  await expect(client.getDelegationEvents(USER)).resolves.toEqual([
    { type: 'delegated', delegator: USER, delegatee: OTHER, ledger: 200_000 },
  ]);
  expect(getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 79_040, endLedger: 200_000, limit: 1000 });
});
