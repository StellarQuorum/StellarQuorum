'use client';

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/** The slice of the Freighter extension API this app uses. */
interface Freighter {
  connect(): Promise<{ publicKey: string }>;
}

declare global {
  interface Window {
    freighter?: Freighter;
  }
}

export interface WalletContextValue {
  /** Connected Stellar address, or null when no wallet is connected. */
  address: string | null;
  /** True while a connect or disconnect request is in flight. */
  pending: boolean;
  /** Message from the last failed attempt, cleared on the next one. */
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Holds the connected wallet address for the client components that need it.
 *
 * Mounted in the root layout, so the address survives client-side navigation
 * between the proposal list and a proposal — the voter connects once and the
 * voting-power preview is already waiting for them. A full page reload drops it
 * and the connect button comes back, which is the honest default for an address
 * the app has to trust Freighter for.
 */
export default function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const freighter = window.freighter;
      if (!freighter) {
        setError("No Stellar wallet extension found. Install Freighter to connect.");
        return;
      }
      const { publicKey } = await freighter.connect();
      setAddress(publicKey);
    } catch (cause) {
      // Covers both a user rejection and a locked extension. The extension's own
      // wording is not a stable API, so its message is shown as-is and anything
      // else falls back to a refusal the user can act on.
      setError(cause instanceof Error ? cause.message : "Wallet connection was refused.");
    } finally {
      setPending(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ address, pending, error, connect, disconnect }),
    [address, pending, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** The connected wallet. Throws outside a WalletProvider, which is a wiring bug. */
export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return value;
}
