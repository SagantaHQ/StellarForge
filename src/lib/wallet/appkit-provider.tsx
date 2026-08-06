"use client";

import { StellarAppKitProvider } from "@saganta/stellar-appkit/react";
import {
  createFreighterConnector,
  createAlbedoConnector,
  createXBullConnector,
} from "@saganta/stellar-appkit";
import type { ReactNode } from "react";

/**
 * §11 — StellarAppKit React provider wrapper.
 *
 * Wraps the app with <StellarAppKitProvider> so all child components
 * can use hooks: useAppKit, useConnect, useSession, useSignIn, etc.
 *
 * The provider creates a single StellarAppKit instance with:
 * - Freighter, Albedo, xBull connectors
 * - TESTNET network
 * - App metadata for SIWS messages
 */

const APP_METADATA = {
  name: "Soroban.Build",
  domain: typeof window !== "undefined" ? window.location.hostname : "localhost",
  uri: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
};

const config = {
  network: "TESTNET" as const,
  connectors: [
    createFreighterConnector(),
    createAlbedoConnector(),
    createXBullConnector(),
  ],
  appMetadata: APP_METADATA,
  restoreOnMount: true,
};

export function AppKitProvider({ children }: { children: ReactNode }) {
  return (
    <StellarAppKitProvider config={config}>
      {children}
    </StellarAppKitProvider>
  );
}
