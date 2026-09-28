import http from 'http';
import type { AddressInfo } from 'net';
import {
  Address,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * A local HTTP server that answers JSON-RPC requests with canned responses.
 *
 * It binds to 127.0.0.1 on an ephemeral port, records every request it
 * receives, and never touches the network — the whole test suite runs
 * offline. Responses are plain strings so malformed payloads (invalid JSON,
 * broken XDR, wrong HTTP status) can be served verbatim.
 */

export interface RpcCall {
  /** JSON-RPC method name sent by the caller. */
  method: string;
  /** JSON-RPC params object, verbatim. */
  params: any;
}

export interface RawReply {
  status?: number;
  contentType?: string;
  body: string;
}

export type Responder = (call: RpcCall) => RawReply;

export function raw(body: string, status = 200, contentType = 'application/json'): RawReply {
  return { status, contentType, body };
}

/** Soroban transaction data accepted by stellar-sdk's simulation parser. */
const EMPTY_TRANSACTION_DATA = new SorobanDataBuilder().build().toXDR('base64');

const DEFAULT_REPLY: RawReply = {
  status: 500,
  contentType: 'text/plain',
  body: 'mock rpc: no response configured for this test',
};

/** The `result` payload of a successful `simulateTransaction` response. */
export function successResult(retval: string, latestLedger = 1000): object {
  return {
    id: 1,
    latestLedger,
    events: [],
    transactionData: EMPTY_TRANSACTION_DATA,
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '50' },
    results: [{ auth: [], xdr: retval }],
    stateChanges: [],
  };
}

/** Canned success response; `retval` is a base64-encoded `xdr.ScVal`. */
export function simulationSuccess(retval: string, latestLedger = 1000): RawReply {
  return raw(JSON.stringify({ jsonrpc: '2.0', id: 1, result: successResult(retval, latestLedger) }));
}

/** Canned contract-level failure: the simulation reports an `error` string. */
export function simulationFailure(message: string): RawReply {
  return raw(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { id: 1, latestLedger: 1000, events: [], error: message },
    }),
  );
}

/** Canned JSON-RPC protocol error (rejected by stellar-sdk before parsing). */
export function rpcError(code: number, message: string): RawReply {
  return raw(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }));
}

/** Canned success envelope around an arbitrary `result` payload. */
export function resultBody(result: object): RawReply {
  return raw(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
}

/** Base64 ScVal for `Option<u32>::Some(value)`. */
export function someVote(value: number): string {
  return nativeToScVal(value, { type: 'u32' }).toXDR('base64');
}

/** Base64 ScVal for `Option<u32>::None`. */
export const NONE_VOTE = xdr.ScVal.scvVoid().toXDR('base64');

/** What a built transaction asked the contract to do, in native values. */
export interface DecodedInvocation {
  source: string;
  contract: string;
  method: string;
  args: unknown[];
}

/** Decodes the `invokeContract` operation inside a simulateTransaction request. */
export function decodeInvocation(transactionXdr: string): DecodedInvocation {
  const tx = xdr.TransactionEnvelope.fromXDR(transactionXdr, 'base64').v1().tx();
  const invoke = tx.operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract();
  const sourceKey = tx.sourceAccount().ed25519();
  if (!sourceKey) {
    throw new Error('expected an ed25519 source account');
  }
  return {
    source: StrKey.encodeEd25519PublicKey(Buffer.from(sourceKey)),
    contract: Address.fromScAddress(invoke.contractAddress()).toString(),
    method: invoke.functionName().toString(),
    args: invoke.args().map(arg => scValToNative(arg)),
  };
}

export class MockRpcServer {
  /** Every request received so far, in arrival order. */
  readonly calls: RpcCall[] = [];
  /** How to answer the next request; reassign per test. */
  responder: Responder = () => DEFAULT_REPLY;

  private constructor(private readonly server: http.Server) {}

  /** URL to hand to `QuorumClient.rpcUrl` — always `http://127.0.0.1:<port>`. */
  get url(): string {
    const { address, port } = this.server.address() as AddressInfo;
    return `http://${address}:${port}`;
  }

  static start(): Promise<MockRpcServer> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const instance = new MockRpcServer(server);
      server.on('request', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405).end('mock rpc only accepts POST');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            res.writeHead(400).end('mock rpc: request body is not JSON');
            return;
          }
          const call: RpcCall = { method: parsed?.method, params: parsed?.params };
          instance.calls.push(call);
          const reply = instance.responder(call);
          res.writeHead(reply.status ?? 200, { 'content-type': reply.contentType ?? 'application/json' });
          res.end(reply.body);
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(instance));
    });
  }

  /** Forget recorded requests and restore the default responder. */
  reset(): void {
    this.calls.length = 0;
    this.responder = () => DEFAULT_REPLY;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Tests keep the connection alive; drop it so close() can finish.
      this.server.closeAllConnections();
      this.server.close(err => (err ? reject(err) : resolve()));
    });
  }
}
