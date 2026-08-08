import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: [
    "@prisma/client",
    "@node-rs/argon2",
    "@node-rs/bcrypt",
    "@saganta/stellar-appkit-siws-verify",
    "@stellar/stellar-sdk",
    "@stellar/stellar-base",
    "tweetnacl",
    "monaco-languageclient",
    "vscode-languageclient",
    "vscode-ws-jsonrpc",
  ],
  // Proxy /lsp and /workspace requests to the LSP gateway server
  // (mini-services/lsp-server, runs on port 3099 in dev).
  // In production, set LSP_GATEWAY_URL to your deployed gateway.
  async rewrites() {
    const lspUrl = process.env.LSP_GATEWAY_URL || "http://localhost:3099";
    return [
      {
        source: "/lsp",
        destination: `${lspUrl}/lsp`,
      },
      {
        source: "/workspace/:path*",
        destination: `${lspUrl}/workspace/:path*`,
      },
    ];
  },
};

export default nextConfig;
