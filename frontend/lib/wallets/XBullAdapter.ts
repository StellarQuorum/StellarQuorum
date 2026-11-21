import { WalletAdapter } from "./types";
import { t } from "@/lib/i18n";

interface XBullWallet {
  connect?: () => Promise<{ publicKey?: string; address?: string } | string>;
  getPublicKey?: () => Promise<string>;
  signTransaction: (transaction: string, options?: { networkPassphrase?: string }) => Promise<{ signedTransaction?: string; signed_envelope_xdr?: string } | string>;
  disconnect?: () => Promise<void>;
}

declare global { interface Window { xBullWallet?: XBullWallet } }

export class XBullAdapter implements WalletAdapter {
  id = "xbull";
  name = "xBull";
  isAvailable() { return typeof window !== "undefined" && !!window.xBullWallet; }
  isConnected() { return this.isAvailable(); }
  async connect() {
    const wallet = window.xBullWallet;
    if (!wallet) throw new Error(t("nav.noWallet"));
    const result = await wallet.connect?.();
    const address = typeof result === "string" ? result : result?.publicKey ?? result?.address ?? await wallet.getPublicKey?.();
    if (!address) throw new Error(t("nav.refused"));
    return address;
  }
  disconnect() { void window.xBullWallet?.disconnect?.(); }
  async signTransaction(transaction: string) {
    const wallet = window.xBullWallet;
    if (!wallet) throw new Error(t("nav.noWallet"));
    const result = await wallet.signTransaction(transaction);
    if (typeof result === "string") return result;
    const signed = result.signedTransaction ?? result.signed_envelope_xdr;
    if (!signed) throw new Error(t("nav.refused"));
    return signed;
  }
}
