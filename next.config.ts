import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow Node.js built-ins in API routes (child_process, fs, path)
  // Prisma must be external — Turbopack can't bundle its native client
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2", "@node-rs/bcrypt", "@saganta/stellar-appkit-siws-verify", "@saganta/stellar-appkit", "@stellar/stellar-sdk"],
  // SSE streaming needs this
  experimental: {
    // Allow longer-running API routes for cargo/stellar builds
    // (up to 5 min for large contracts)
  },
};

export default nextConfig;
