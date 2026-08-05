import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow Node.js built-ins in API routes (child_process, fs, path)
  serverExternalPackages: [],
  // SSE streaming needs this
  experimental: {
    // Allow longer-running API routes for cargo/stellar builds
    // (up to 5 min for large contracts)
  },
};

export default nextConfig;
