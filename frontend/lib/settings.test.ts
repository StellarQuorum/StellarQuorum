import { DEFAULT_SETTINGS, isValidRpcUrl } from "./settings";

// Issue #279: the RPC override is optional, but when it is set it has to be a
// web URL the browser can actually call.

describe("isValidRpcUrl", () => {
  it("accepts an empty value, which keeps the default endpoint", () => {
    expect(isValidRpcUrl("")).toBe(true);
    expect(isValidRpcUrl("   ")).toBe(true);
  });

  it("accepts absolute http and https URLs", () => {
    expect(isValidRpcUrl("https://soroban-testnet.stellar.org")).toBe(true);
    expect(isValidRpcUrl("http://localhost:8000")).toBe(true);
  });

  it("rejects relative paths and other schemes", () => {
    expect(isValidRpcUrl("soroban-testnet.stellar.org")).toBe(false);
    expect(isValidRpcUrl("/rpc")).toBe(false);
    expect(isValidRpcUrl("ftp://rpc.example.com")).toBe(false);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("keeps status-change notifications on and the RPC on its default", () => {
    expect(DEFAULT_SETTINGS).toEqual({ rpcUrl: "", notifyStatusChanges: true });
  });
});
