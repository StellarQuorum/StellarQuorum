import { AlbedoAdapter } from "./AlbedoAdapter";
import { FreighterAdapter } from "./FreighterAdapter";
import { WalletAdapter } from "./types";
import { XBullAdapter } from "./XBullAdapter";

export { AlbedoAdapter, FreighterAdapter, XBullAdapter };
export type { WalletAdapter };

export function getAvailableWallets(): WalletAdapter[] {
  const adapters = [new FreighterAdapter(), new AlbedoAdapter(), new XBullAdapter()];
  return adapters.filter((adapter) => adapter.isAvailable());
}

export function getWalletAdapter(id: string): WalletAdapter | null {
  const adapters = [new FreighterAdapter(), new AlbedoAdapter(), new XBullAdapter()];
  const adapter = adapters.find((a) => a.id === id);
  return adapter && adapter.isAvailable() ? adapter : null;
}
