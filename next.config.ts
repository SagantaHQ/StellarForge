import type { NextConfig } from "next";
import path from "path";

// MonacoWebpackPlugin is only needed for webpack-based dev mode.
// In production (next build + next start with Turbopack), it's not
// needed and may not be installed. Load it dynamically.
let MonacoWebpackPlugin: any = null;
try {
  MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
} catch {
  // Module not installed — fine for production builds.
}

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-chat-*.space-z.ai",
    "localhost:3000",
    "127.0.0.1:3000",
    "stellarforge.com",
    "*.stellarforge.com"
  ],
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
  webpack: (config, { isServer, dev }) => {
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
      "monaco-editor/esm/vs/editor/editor.api.js": "monaco-editor",
    };

    if (dev) {
      const existing = config.watchOptions?.ignored;
      const ignorePaths = [
        path.resolve(__dirname, "data/**"),
        path.resolve(__dirname, "data/**/*"),
        path.resolve(__dirname, "download/**"),
        path.resolve(__dirname, "download/**/*"),
        path.resolve(__dirname, ".zscripts/**"),
        path.resolve(__dirname, ".zscripts/**/*"),
        path.resolve(__dirname, "upload/**"),
        path.resolve(__dirname, "upload/**/*"),
        path.resolve(__dirname, "db/**"),
        path.resolve(__dirname, "db/**/*"),
        path.resolve(__dirname, "scripts/**"),
        path.resolve(__dirname, "scripts/**/*"),
      ];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: Array.isArray(existing) ? [...existing, ...ignorePaths] : ignorePaths,
      };
    }

    // Only add MonacoWebpackPlugin if it's available (dev mode with webpack)
    if (MonacoWebpackPlugin) {
      config.plugins = [
        ...config.plugins,
        new MonacoWebpackPlugin()
      ];
    }

    return config;
  },
  turbopack: {
    resolveAlias: {
      "@trezor/connect-web": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/connect-plugin-stellar": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/utils": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport-webusb": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/transport-webhid": path.resolve(__dirname, "src/stubs/empty.ts"),
      "@trezor/hw-app-str": path.resolve(__dirname, "src/stubs/empty.ts"),
      "monaco-editor/esm/vs/editor/editor.api.js": "monaco-editor",
    },
  },
  async rewrites() {
    const lspUrl = process.env.LSP_GATEWAY_URL || "http://localhost:3099";
    const collabUrl = process.env.COLLAB_WS_URL || "http://localhost:3002";
    return [
      {
        source: "/lsp",
        destination: `${lspUrl}/lsp`,
      },
      {
        source: "/workspace/:path*",
        destination: `${lspUrl}/workspace/:path*`,
      },
      {
        source: "/collab/:path*",
        destination: `${collabUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
