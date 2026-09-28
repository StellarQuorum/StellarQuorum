import http from 'http';
import { MockRpcServer, simulationSuccess, someVote } from './mockRpc';

/** Raw POST over Node's http module, independent of stellar-sdk. */
function post(url: string, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

describe('MockRpcServer', () => {
  test('serves a canned response verbatim and records the request', async () => {
    const canned = simulationSuccess(someVote(1));
    const rpc = await MockRpcServer.start();
    rpc.responder = () => canned;
    try {
      const request = { jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: { transaction: 'AAAA' } };
      const res = await post(rpc.url, request);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual(JSON.parse(canned.body));
      expect(rpc.calls).toEqual([{ method: 'simulateTransaction', params: { transaction: 'AAAA' } }]);
    } finally {
      await rpc.close();
    }
  });

  test('binds to loopback only', async () => {
    const rpc = await MockRpcServer.start();
    const { url } = rpc;
    await rpc.close();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
