import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  EVENT_TOPICS,
  EventDecodeError,
  decodeEvent,
  decodeEvents,
} from '../src/events';
import type { RawContractEvent } from '../src/events';
import { enumVariant, structVal } from './xdr';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const VOTER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const addr = (who: string) => new Address(who).toScVal();
const u64 = (n: bigint) => nativeToScVal(n, { type: 'u64' });
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const str = (s: string) => nativeToScVal(s, { type: 'string' });

/** A contract event as the RPC hands it over: topic[0] names the event. */
function event(topic: string, value: xdr.ScVal): RawContractEvent {
  return { topic: [xdr.ScVal.scvSymbol(topic)], value };
}

const sample: Array<[string, xdr.ScVal, Record<string, unknown>]> = [
  [
    'delegated',
    structVal({ delegator: addr(VOTER), delegatee: addr(VOTER) }),
    { type: 'delegated', delegator: VOTER, delegatee: VOTER },
  ],
  [
    'contract_initialized',
    structVal({ admin: addr(VOTER), guardian: addr(VOTER), token: addr(VOTER),
      quorum_bps: u32(500), voting_period: u32(100), timelock_period: u32(50),
      execution_grace_period: u32(700), proposal_threshold: i128(10n) }),
    { type: 'contract_initialized', admin: VOTER, guardian: VOTER, token: VOTER,
      quorumBps: 500, votingPeriod: 100, timelockPeriod: 50, executionGracePeriod: 700, proposalThreshold: 10n },
  ],
  ...(['contract_paused', 'contract_unpaused'] as const).map(topic => [
    topic, structVal({ caller: addr(VOTER) }), { type: topic, caller: VOTER },
  ] as [string, xdr.ScVal, Record<string, unknown>]),
  [
    'proposal_created',
    structVal({
      id: u64(7n),
      proposer: addr(VOTER),
      title: str('Raise quorum'),
      start_ledger: u32(1000),
      end_ledger: u32(2000),
      quorum_required: i128(50n),
    }),
    {
      type: 'proposal_created',
      id: 7n,
      proposer: VOTER,
      title: 'Raise quorum',
      startLedger: 1000,
      endLedger: 2000,
      quorumRequired: 50n,
    },
  ],
  [
    'vote_cast',
    structVal({
      proposal_id: u64(7n),
      voter: addr(VOTER),
      support: u32(1),
      voting_power: i128(120n),
    }),
    { type: 'vote_cast', proposalId: 7n, voter: VOTER, support: 1, votingPower: 120n },
  ],
  [
    'proposal_finalized',
    structVal({
      id: u64(7n),
      status: enumVariant('Queued'),
      for_votes: i128(100n),
      against_votes: i128(20n),
      abstain_votes: i128(5n),
    }),
    {
      type: 'proposal_finalized',
      id: 7n,
      status: 'Queued',
      forVotes: 100n,
      againstVotes: 20n,
      abstainVotes: 5n,
    },
  ],
  [
    'proposal_queued',
    structVal({ id: u64(7n), queue_ledger: u32(4000) }),
    { type: 'proposal_queued', id: 7n, queueLedger: 4000 },
  ],
  ['proposal_executed', structVal({ id: u64(7n) }), { type: 'proposal_executed', id: 7n }],
  [
    'proposal_cancelled',
    structVal({ id: u64(7n), caller: addr(VOTER) }),
    { type: 'proposal_cancelled', id: 7n, caller: VOTER },
  ],
  ['proposal_expired', structVal({ id: u64(7n) }), { type: 'proposal_expired', id: 7n }],
  [
    'transfer',
    structVal({ from: addr(VOTER), to: addr(VOTER), amount: i128(10n) }),
    { type: 'transfer', from: VOTER, to: VOTER, amount: 10n },
  ],
  [
    'mint',
    structVal({ to: addr(VOTER), amount: i128(10n), total_supply: i128(1000n) }),
    { type: 'mint', to: VOTER, amount: 10n, totalSupply: 1000n },
  ],
  [
    'burn',
    structVal({ from: addr(VOTER), amount: i128(10n), total_supply: i128(990n) }),
    { type: 'burn', from: VOTER, amount: 10n, totalSupply: 990n },
  ],
  [
    'approve',
    structVal({
      owner: addr(VOTER),
      spender: addr(VOTER),
      amount: i128(10n),
      expiration_ledger: u32(5000),
    }),
    { type: 'approve', owner: VOTER, spender: VOTER, amount: 10n, expirationLedger: 5000 },
  ],
  [
    'admin_transferred',
    structVal({ previous_admin: addr(VOTER), new_admin: addr(VOTER) }),
    { type: 'admin_transferred', previousAdmin: VOTER, newAdmin: VOTER },
  ],
  [
    'admin_transfer_proposed',
    structVal({ current_admin: addr(VOTER), proposed_admin: addr(VOTER) }),
    { type: 'admin_transfer_proposed', currentAdmin: VOTER, proposedAdmin: VOTER },
  ],
  [
    'admin_transfer_cancelled',
    structVal({ admin: addr(VOTER) }),
    { type: 'admin_transfer_cancelled', admin: VOTER },
  ],
  [
    'proposal_vetoed',
    structVal({ id: u64(7n), guardian: addr(VOTER), reason: str('Invalid proposal') }),
    { type: 'proposal_vetoed', id: 7n, guardian: VOTER, reason: 'Invalid proposal' },
  ],
  [
    'proposal_action_set',
    structVal({ id: u64(7n), target: addr(VOTER), function: str('execute') }),
    { type: 'proposal_action_set', id: 7n, target: VOTER, function: 'execute' },
  ],
  [
    'action_executed',
    structVal({ id: u64(7n), index: u32(1), target: addr(VOTER), function: str('execute') }),
    { type: 'action_executed', id: 7n, index: 1, target: VOTER, function: 'execute' },
  ],
  [
    'guardian_changed',
    structVal({ previous_guardian: addr(VOTER), new_guardian: addr(VOTER) }),
    { type: 'guardian_changed', previousGuardian: VOTER, newGuardian: VOTER },
  ],
  [
    'deposit_refunded',
    structVal({ id: u64(7n), proposer: addr(VOTER), amount: i128(100n) }),
    { type: 'deposit_refunded', id: 7n, proposer: VOTER, amount: 100n },
  ],
  [
    'deposit_forfeited',
    structVal({ id: u64(7n), amount: i128(50n) }),
    { type: 'deposit_forfeited', id: 7n, amount: 50n },
  ],
  [
    'target_allowlist_updated',
    structVal({ admin: addr(VOTER), target: addr(VOTER), allowed: nativeToScVal(true) }),
    { type: 'target_allowlist_updated', admin: VOTER, target: VOTER, allowed: true },
  ],
  [
    'proposal_deposit_updated',
    structVal({ amount: i128(500n) }),
    { type: 'proposal_deposit_updated', amount: 500n },
  ],
  [
    'proposer_cooldown_updated',
    structVal({ ledgers: u32(1000) }),
    { type: 'proposer_cooldown_updated', ledgers: 1000 },
  ],
  [
    'upgraded',
    structVal({ new_wasm_hash: str('aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899') }),
    { type: 'upgraded', newWasmHash: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899' },
  ],
  [
    'stake',
    structVal({ owner: addr(VOTER), amount: i128(1000n), unlock_ledger: u32(5000) }),
    { type: 'stake', owner: VOTER, amount: 1000n, unlockLedger: 5000 },
  ],
  [
    'stake_increased',
    structVal({ owner: addr(VOTER), amount: i128(1500n), unlock_ledger: u32(5000) }),
    { type: 'stake_increased', owner: VOTER, amount: 1500n, unlockLedger: 5000 },
  ],
  [
    'stake_extended',
    structVal({ owner: addr(VOTER), amount: i128(1000n), unlock_ledger: u32(6000) }),
    { type: 'stake_extended', owner: VOTER, amount: 1000n, unlockLedger: 6000 },
  ],
  [
    'unstake',
    structVal({ owner: addr(VOTER), amount: i128(1000n) }),
    { type: 'unstake', owner: VOTER, amount: 1000n },
  ],
];

describe('decoding every emitted event', () => {
  it.each(sample)('%s', (topic, value, expected) => {
    expect(decodeEvent(event(topic, value))).toEqual(expected);
  });

  it('covers every topic the SDK declares', () => {
    expect(sample.map(([topic]) => topic).sort()).toEqual([...EVENT_TOPICS].sort());
  });
});

describe('unknown events are ignored, not thrown', () => {
  it('returns null for an unrecognised topic', () => {
    expect(decodeEvent(event('something_else', structVal({ id: u64(1n) })))).toBeNull();
  });

  it('returns null when the first topic entry is not a symbol', () => {
    expect(decodeEvent({ topic: [u64(1n)], value: structVal({ id: u64(1n) }) })).toBeNull();
  });

  it('returns null for an empty topic', () => {
    expect(decodeEvent({ topic: [], value: structVal({ id: u64(1n) }) })).toBeNull();
  });

  it('drops unknown topics when decoding a batch', () => {
    const known = event('proposal_executed', structVal({ id: u64(2n) }));
    const unknown = event('random_topic', structVal({ id: u64(3n) }));
    expect(decodeEvents([unknown, known, unknown])).toEqual([
      { type: 'proposal_executed', id: 2n },
    ]);
  });
});

describe('malformed payloads for known topics', () => {
  it('throws EventDecodeError when the value is not a struct', () => {
    expect(() => decodeEvent(event('proposal_executed', nativeToScVal(5, { type: 'i32' }))))
      .toThrow(EventDecodeError);
  });

  it('throws EventDecodeError when a field is missing', () => {
    expect(() => decodeEvent(event('proposal_executed', structVal({ other: u64(1n) }))))
      .toThrow('missing field "id"');
  });

  it('exposes the topic on the error', () => {
    try {
      decodeEvent(event('vote_cast', structVal({ proposal_id: u64(1n) })));
      throw new Error('expected EventDecodeError');
    } catch (error) {
      expect(error).toBeInstanceOf(EventDecodeError);
      expect((error as EventDecodeError).topic).toBe('vote_cast');
    }
  });
});

describe('topic coverage against the Rust contracts', () => {
  /** Every `Symbol::new(env, "…")` topic published by either contract. */
  const rustTopics = (): string[] => {
    const files = ['governance/src/lib.rs', 'token/src/lib.rs'];
    return files.flatMap(file => {
      const src = readFileSync(join(__dirname, '../../contracts', file), 'utf8');
      return [...src.matchAll(/Symbol::new\(\s*&?env,\s*"([a-z_]+)"\s*\)/g)].map(m => m[1]);
    });
  };

  it('matches EVENT_TOPICS exactly', () => {
    expect([...new Set(rustTopics())].sort()).toEqual([...EVENT_TOPICS].sort());
  });
});
