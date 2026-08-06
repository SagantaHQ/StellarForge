import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2", "@node-rs/bcrypt", "@saganta/stellar-appkit-siws-verify", "@stellar/stellar-sdk", "@stellar/stellar-base", "tweetnacl"],
};

export default nextConfig;
