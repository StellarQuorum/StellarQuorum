'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { getAvailableWallets, getWalletAdapter } from "@/lib/wallets";
import { WalletAdapter } from "@/lib/wallets/types";

export interface WalletContextValue {
  address: string | null;
  connectedAddresses: string[];
  pending: boolean;
  error: string | null;
  activeWalletId: string | null;
  availableWallets: WalletAdapter[];
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
  switchAccount: (address: string) => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export default function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connectedAddresses, setConnectedAddresses] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([]);

  useEffect(() => {
    setAvailableWallets(getAvailableWallets());
  }, []);

  const connect = useCallback(
    async (walletId?: string) => {
      setPending(true);
      setError(null);
      try {
        const wallets = availableWallets.length ? availableWallets : getAvailableWallets();
        setAvailableWallets(wallets);
        if (wallets.length === 0) {
          setError(t("nav.noWallet"));
          return;
        }

        const targetWallet = walletId
          ? getWalletAdapter(walletId) || wallets[0]
          : wallets[0];

        const publicKey = await targetWallet.connect();
        setAddress(publicKey);
        setActiveWalletId(targetWallet.id);

        setConnectedAddresses((prev) => {
          const updated = [publicKey, ...prev.filter((a) => a !== publicKey)];
          return updated.slice(0, 10);
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("nav.refused"));
      } finally {
        setPending(false);
      }
    },
    [availableWallets]
  );

  const disconnect = useCallback(() => {
    const adapter = activeWalletId ? getWalletAdapter(activeWalletId) : null;
    if (adapter) {
      adapter.disconnect();
    }
    setAddress(null);
    setActiveWalletId(null);
    setError(null);
  }, [activeWalletId]);

  const switchAccount = useCallback(
    async (newAddress: string) => {
      if (!activeWalletId) {
        setError(t("nav.notConnected"));
        return;
      }

      const adapter = getWalletAdapter(activeWalletId);
      if (!adapter) {
        setError(t("nav.walletNotFound"));
        return;
      }

      try {
        setPending(true);
        setError(null);
        setAddress(newAddress);

        setConnectedAddresses((prev) => {
          const updated = [newAddress, ...prev.filter((a) => a !== newAddress)];
          return updated.slice(0, 10);
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("nav.refused"));
      } finally {
        setPending(false);
      }
    },
    [activeWalletId]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      connectedAddresses,
      pending,
      error,
      activeWalletId,
      availableWallets,
      connect,
      disconnect,
      switchAccount,
    }),
    [address, connectedAddresses, pending, error, activeWalletId, availableWallets, connect, disconnect, switchAccount]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return value;
}
