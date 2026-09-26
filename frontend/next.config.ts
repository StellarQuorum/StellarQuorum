import type { NextConfig } from "next";
import path from "path";

// Soroban RPC endpoints the app talks to. The configured URL is added to these
// on top (see `rpcOrigin`), so a self-hosted node is permitted without having to
// edit the policy — and so is the `*.stellar.org` range both public networks use.
const PUBLIC_RPC_ORIGINS = [
  "https://soroban-testnet.stellar.org",
  "https://soroban-rpc.stellar.org",
  "wss://soroban-testnet.stellar.org",
  "wss://soroban-rpc.stellar.org",
];

/** Browser-extension origins, for wallets that transport requests themselves. */
const WALLET_EXTENSION_ORIGINS = ["chrome-extension:", "moz-extension:"];

/**
 * Origin of a configured RPC URL, or null when there is nothing usable to
 * permit. A malformed URL must not end up in the policy as a broken source.
 */
export function rpcOrigin(rpcUrl: string | undefined): string | null {
  if (!rpcUrl) return null;
  try {
    return new URL(rpcUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy for every response.
 *
 * The app renders untrusted proposal text and holds a wallet connection, so the
 * policy is locked to same-origin by default and only the three things that
 * genuinely need out are allowed: the Soroban RPC endpoint, the Stellar
 * network's origins, and the wallet extension. `unsafe-inline` on scripts is
 * required by Next's own bootstrap markup; `unsafe-eval` is confined to
 * development, where the dev server compiles on the fly.
 */
export function buildCsp(rpcUrl: string | undefined, isDev: boolean): string {
  const connect = [
    "'self'",
    ...PUBLIC_RPC_ORIGINS,
    "https://*.stellar.org",
    "wss://*.stellar.org",
    ...WALLET_EXTENSION_ORIGINS,
    // HMR over a websocket, development only.
    ...(isDev ? ["ws:", "http:", "https:"] : []),
    ...(rpcOrigin(rpcUrl) ? [rpcOrigin(rpcUrl)!] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    // frame-ancestors is the modern spelling of X-Frame-Options: DENY; both are
    // sent because not every browser honours the header form.
    "frame-ancestors": ["'none'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // Components set inline style widths (the quorum bars), and Next inlines
    // the font/CSS at build time.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
  };

  if (!isDev) {
    // Any request the app would have made over http is upgraded, so a mixed
    // content slip cannot quietly downgrade the RPC call.
    directives["upgrade-insecure-requests"] = [];
  }

  return Object.entries(directives)
    .map(([directive, sources]) => (sources.length ? `${directive} ${sources.join(" ")}` : directive))
    .join("; ");
}

/**
 * Issue #142: headers applied to every route. `source: "/(.*)"` covers the pages
 * and the generated /robots.txt and /sitemap.xml alike.
 */
function securityHeaders(): { key: string; value: string }[] {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    { key: "Content-Security-Policy", value: buildCsp(process.env.NEXT_PUBLIC_STELLAR_RPC_URL, isDev) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // HSTS only once there is a real origin to protect — sending it from
    // localhost would pin developers to http.
    ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}

const nextConfig: NextConfig = {
  // Repo root rather than frontend/: @quorum/sdk is linked from ../sdk, and
  // Turbopack cannot resolve files outside its root.
  turbopack: { root: path.resolve(__dirname, "..") },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default nextConfig;
