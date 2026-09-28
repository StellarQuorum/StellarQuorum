import { StrKey } from '@stellar/stellar-sdk';
import { QuorumClient } from '../src';
import type { QuorumClientConfig } from '../src';
import {
  MockRpcServer,
  NONE_VOTE,
  decodeInvocation,
  raw,
  resultBody,
  rpcError,
  simulationFailure,
  simulationSuccess,
  someVote,
  successResult,
} from './mockRpc';

const GOVERNANCE_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 8));
const VOTER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const READ_ONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

let rpc: MockRpcServer;
let client: QuorumClient;

function makeClient(rpcUrl: string): QuorumClient {
  const config: QuorumClientConfig = {
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    governanceContractId: GOVERNANCE_ID,
    tokenContractId: TOKEN_ID,
  };
  return new QuorumClient(config);
}

function serve(reply: { status?: number; contentType?: string; body: string }): void {
  rpc.responder = () => reply;
}

describe('QuorumClient simulation path against a mock RPC', () => {
  beforeAll(async () => {
    rpc = await MockRpcServer.start();
  });

  afterAll(async () => {
    await rpc.close();
  });

  beforeEach(() => {
    rpc.reset();
    client = makeClient(rpc.url);
  });

  describe('success responses', () => {
    for (const support of [0, 1, 2] as const) {
      test(`decodes Some(${support}) as vote support`, async () => {
        serve(simulationSuccess(someVote(support)));
        expect(await client.getVote(7n, VOTER)).toBe(support);
      });
    }

    test('decodes None as null (the voter has not voted)', async () => {
      serve(simulationSuccess(NONE_VOTE));
      expect(await client.getVote(7n, VOTER)).toBeNull();
    });

    test('hasVoted is true when a vote exists', async () => {
      serve(simulationSuccess(someVote(1)));
      expect(await client.hasVoted(7n, VOTER)).toBe(true);
    });

    test('hasVoted is false when no vote exists', async () => {
      serve(simulationSuccess(NONE_VOTE));
      expect(await client.hasVoted(7n, VOTER)).toBe(false);
    });

    test('encodes the read as get_vote(u64, address) in one request', async () => {
      serve(simulationSuccess(someVote(2)));
      await client.getVote(42n, VOTER);

      expect(rpc.calls).toHaveLength(1);
      const [call] = rpc.calls;
      expect(call.method).toBe('simulateTransaction');

      const invocation = decodeInvocation(call.params.transaction);
      expect(invocation.source).toBe(READ_ONLY_SOURCE);
      expect(invocation.contract).toBe(GOVERNANCE_ID);
      expect(invocation.method).toBe('get_vote');
      expect(invocation.args).toHaveLength(2);
      // scValToNative returns bigint only for 64-bit ScVals, so this also
      // pins the proposal id encoding to u64.
      expect(invocation.args[0]).toBe(42n);
      expect(invocation.args[1]).toBe(VOTER);
    });
  });

  describe('contract error responses', () => {
    test('rejects with the simulation error message', async () => {
      serve(simulationFailure('HostError: Error(Contract, #1) NotYetVoting'));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow(
        'Simulation of get_vote failed: HostError: Error(Contract, #1) NotYetVoting',
      );
    });

    test('surfaces JSON-RPC protocol errors', async () => {
      serve(rpcError(-32603, 'Internal error'));
      await expect(client.getVote(1n, VOTER)).rejects.toEqual({ code: -32603, message: 'Internal error' });
    });
  });

  describe('malformed responses', () => {
    test('rejects a non-JSON body', async () => {
      serve(raw('<html>gateway error</html>', 200, 'text/html'));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow();
    });

    test('rejects a response with neither result nor error', async () => {
      serve(raw(JSON.stringify({ jsonrpc: '2.0', id: 1 })));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow(TypeError);
    });

    test('rejects a success response without a return value', async () => {
      serve(resultBody({ ...successResult(NONE_VOTE), results: [] }));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow(
        'Simulation of get_vote returned no result',
      );
    });

    test('rejects a success response with invalid return-value XDR', async () => {
      serve(simulationSuccess('%%%not-an-scval%%%'));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow(/XDR/);
    });

    test('rejects an HTTP 500', async () => {
      serve(raw(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), 500));
      await expect(client.getVote(1n, VOTER)).rejects.toThrow('Request failed with status code 500');
    });
  });

  describe('transport safety', () => {
    test('rejects a remote plain-HTTP RPC URL', () => {
      expect(() => makeClient('http://rpc.example.com')).toThrow(/insecure/);
    });

    test('accepts an HTTPS RPC URL without connecting', () => {
      expect(() => makeClient('https://rpc.example.com')).not.toThrow();
    });
  });
});
