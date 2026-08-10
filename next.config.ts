import type { NextConfig } from "next";
import path from "path";

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
  webpack: (config, { isServer }) => {
    const stubPath = path.resolve(__dirname, "src/stubs/empty.ts");
    
    // Alias all Trezor packages to an empty stub — we don't use Trezor
    // wallets, and their ESM exports are broken with webpack.
    // This prevents "Module not found" errors during compilation.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@trezor/connect-web": stubPath,
      "@trezor/connect-plugin-stellar": stubPath,
      "@trezor/utils": stubPath,
      "@trezor/transport": stubPath,
      "@trezor/transport-webusb": stubPath,
      "@trezor/transport-webhid": stubPath,
      "@trezor/hw-app-str": stubPath,
    };
    
    return config;
  },
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
