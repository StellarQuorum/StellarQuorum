// Smoke test for the package exports: both `require('@quorum/sdk')` and
// `import '@quorum/sdk')` must resolve through the exports map, expose the
// same API, and keep the Freighter helper behind its optional subpath.
//
// Run after `npm run build`: `npm run test:smoke`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT_EXPORTS = [
  'EVENT_TOPICS',
  'EventDecodeError',
  'GovernanceError',
  'MAINNET',
  'QuorumClient',
  'TESTNET',
  'TokenError',
  'contractErrorCode',
  'decodeEvent',
  'decodeEvents',
  'parseGovernanceError',
  'parseTokenError',
];

const FREIGHTER_EXPORTS = [
  'FreighterError',
  'FreighterErrorCode',
  'getFreighterAddress',
  'isFreighterAvailable',
  'signWithFreighter',
];

const keys = ns => Object.keys(ns).filter(key => key !== '__esModule').sort();

const cjs = require('@quorum/sdk');
const esm = await import('@quorum/sdk');
const cjsFreighter = require('@quorum/sdk/freighter');
const esmFreighter = await import('@quorum/sdk/freighter');

assert.deepEqual(keys(cjs), keys(esm), 'root exports differ between CJS and ESM');
assert.deepEqual(keys(cjs), [...ROOT_EXPORTS].sort(), 'unexpected root exports');
assert.deepEqual(keys(cjsFreighter), keys(esmFreighter), 'freighter exports differ between CJS and ESM');
assert.deepEqual(keys(cjsFreighter), [...FREIGHTER_EXPORTS].sort(), 'unexpected freighter exports');

// The wallet helper stays an optional entry point: the package root must not
// load it, so Node consumers never touch @stellar/freighter-api.
assert.ok(!('signWithFreighter' in cjs), 'freighter leaked into the root entry');
assert.ok(!('signWithFreighter' in esm), 'freighter leaked into the root entry');

assert.match(require.resolve('@quorum/sdk'), /dist[\\/]cjs[\\/]index\.js$/);
assert.match(require.resolve('@quorum/sdk/freighter'), /dist[\\/]cjs[\\/]freighter\.js$/);

console.log('smoke: root and ./freighter load and agree in both ESM and CJS');
