import { xdr } from '@stellar/stellar-sdk';

/** A `#[contracttype]` unit enum variant: `ScVec[ScSymbol(name)]`. */
export const enumVariant = (name: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);

/** Builds a struct `ScVal`. Soroban requires struct maps sorted by key. */
export function structVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields).sort().map(key => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] })),
  );
}
