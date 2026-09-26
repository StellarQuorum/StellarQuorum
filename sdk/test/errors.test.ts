import { readFileSync } from 'fs';
import { join } from 'path';
import { GovernanceError, TokenError, parseGovernanceError, parseTokenError, contractErrorCode } from '../src/errors';

/** name → code pairs of a `#[contracterror]` enum, read from the Rust source. */
function rustEnum(file: string, name: string): Record<string, number> {
  const src = readFileSync(join(__dirname, '../../contracts', file), 'utf8');
  const body = new RegExp(`pub enum ${name} \\{([^}]*)\\}`).exec(src)![1];
  return Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
}

/** name → code pairs of a numeric TS enum (drops the reverse mapping). */
const tsEnum = (e: object) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === 'number'));

describe('error enums match the Rust source', () => {
  it('GovernanceError', () => {
    expect(tsEnum(GovernanceError)).toEqual(rustEnum('governance/src/lib.rs', 'GovernanceError'));
  });
  it('TokenError', () => {
    expect(tsEnum(TokenError)).toEqual(rustEnum('token/src/lib.rs', 'TokenError'));
  });
});

describe('parsing raw contract errors', () => {
  it('reads the code from strings and Error objects', () => {
    expect(contractErrorCode('HostError: Error(Contract, #6)')).toBe(6);
    expect(contractErrorCode(new Error('failed: Error(Contract, #12)'))).toBe(12);
    expect(contractErrorCode('Error(WasmVm, InvalidAction)')).toBeUndefined();
  });

  it('maps codes to the right enum', () => {
    expect(parseGovernanceError('Error(Contract, #6)')).toBe(GovernanceError.QuorumNotReached);
    expect(parseTokenError('Error(Contract, #3)')).toBe(TokenError.InsufficientBalance);
  });

  it('rejects codes outside the enum', () => {
    expect(parseGovernanceError('Error(Contract, #99)')).toBeUndefined();
    expect(parseTokenError('Error(Contract, #8)')).toBeUndefined();
  });
});
