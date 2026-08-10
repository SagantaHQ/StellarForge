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
  // Webpack config — used when running with --webpack flag.
  // Aliases Trezor packages to an empty stub (we don't use Trezor wallets,
  // and their ESM exports are broken with webpack).
  webpack: (config, { isServer }) => {
    const stubPath = path.resolve(__dirname, "src/stubs/empty.ts");
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
  // Turbopack config — used by default in Next.js 16 dev mode.
  // Alias Trezor packages to the empty stub here too.
  turbopack: {
    resolveAlias: {
      "@trezor/connect-web": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/connect-plugin-stellar": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/utils": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport-webusb": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport-webhid": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/hw-app-str": path.resolve(__dirname, "src/stubs/empty.ts"),
    },
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
