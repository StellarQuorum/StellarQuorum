export function isValidStellarAddress(address: string): boolean {
  return /^[CG][A-Z2-7]{55}$/.test(address);
}
