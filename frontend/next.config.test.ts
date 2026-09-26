import nextConfig, { buildCsp, rpcOrigin } from "./next.config";

// Issue #142: these headers are the whole point of the file, so they are
// asserted here rather than trusted to review. A CSP that quietly drops the RPC
// endpoint or the wallet extension breaks signing at runtime, and one that drops
// 'self' from script-src breaks the app outright.
const headersFor = async (): Promise<Map<string, string>> => {
  const [rule] = await nextConfig.headers!();
  expect(rule.source).toBe("/(.*)");
  return new Map(rule.headers.map((header) => [header.key, header.value]));
};

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("security headers", () => {
  it("sets the four baseline headers on every route", async () => {
    const headers = await headersFor();

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("locks the policy to same-origin with no plugin or base-tag escape", async () => {
    const policy = (await headersFor()).get("Content-Security-Policy")!;

    expect(directive(policy, "default-src")).toEqual(["'self'"]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "script-src")).toContain("'self'");
  });

  it("permits the configured Soroban RPC endpoint", () => {
    const policy = buildCsp("https://rpc.example.com/soroban", false);

    expect(directive(policy, "connect-src")).toContain("https://rpc.example.com");
    // The public testnet endpoint is permitted whatever is configured, so the
    // SDK default keeps working.
    expect(directive(policy, "connect-src")).toContain("https://soroban-testnet.stellar.org");
  });

  it("permits the wallet extension", () => {
    const connect = directive(buildCsp(undefined, false), "connect-src");

    expect(connect).toContain("chrome-extension:");
    expect(connect).toContain("moz-extension:");
  });

  it("keeps development affordances out of the production policy", () => {
    expect(directive(buildCsp(undefined, false), "script-src")).not.toContain("'unsafe-eval'");
    expect(buildCsp(undefined, false)).toContain("upgrade-insecure-requests");
    expect(directive(buildCsp(undefined, true), "script-src")).toContain("'unsafe-eval'");
    expect(buildCsp(undefined, true)).not.toContain("upgrade-insecure-requests");
  });
});

describe("rpcOrigin", () => {
  it("reduces a configured URL to its origin", () => {
    expect(rpcOrigin("https://rpc.example.com/soroban?x=1")).toBe("https://rpc.example.com");
  });

  it("returns null rather than a broken source for a missing or malformed URL", () => {
    expect(rpcOrigin(undefined)).toBeNull();
    expect(rpcOrigin("")).toBeNull();
    expect(rpcOrigin("not a url")).toBeNull();
    expect(buildCsp("not a url", false)).not.toContain("not a url");
  });
});
