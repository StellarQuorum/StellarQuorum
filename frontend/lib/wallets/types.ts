export interface WalletAdapter {
  id: string;
  name: string;
  isAvailable(): boolean;
  isConnected(): boolean | Promise<boolean>;
  connect(): Promise<string>;
  disconnect(): void;
  signTransaction(transaction: string): Promise<string>;
}

export interface FreighterError {
  code?: string;
  message: string;
}
