import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Repo root rather than frontend/: @quorum/sdk is linked from ../sdk, and
  // Turbopack cannot resolve files outside its root.
  turbopack: { root: path.resolve(__dirname, "..") },
  /* config options here */
};

export default nextConfig;
