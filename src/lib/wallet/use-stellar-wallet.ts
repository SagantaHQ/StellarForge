"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * §11 — Wallet connection hook using @saganta/stellar-appkit.
 *
 * Wraps the StellarAppKit client with React state management.
 * Supports Freighter, Albedo, xBull, and Ledger connectors.
 *
 * SIWS (Sign-In With Stellar) flow:
 *   1. connect() — opens wallet, user approves connection
 *   2. getNonce() — fetches a server-issued nonce
 *   3. signInWithStellar() — wallet signs the SIWS message
 *   4. verifyOnServer() — server verifies signature + saves profile
 */

type ConnectorId = "freighter" | "albedo" | "xbull" | "ledger";

interface WalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  connector: ConnectorId | null;
  error: string | null;
}

const APP_METADATA = {
  name: "Soroban.Build",
  domain: typeof window !== "undefined" ? window.location.hostname : "localhost",
  uri: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
};

export function useStellarWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    connected: false,
    connecting: false,
    connector: null,
    error: null,
  });
  const appkitRef = useRef<unknown>(null);

  // Lazy-load the StellarAppKit client (browser-only)
  const getAppKit = useCallback(async () => {
    if (appkitRef.current) return appkitRef.current;

    const { StellarAppKit, createFreighterConnector, createAlbedoConnector, createXBullConnector } = await import("@saganta/stellar-appkit");

    // Only use connectors whose dependencies are installed.
    // Ledger (@ledgerhq/*) is omitted — install separately if needed.
    const connectors = [
      createFreighterConnector(),
      createAlbedoConnector(),
      createXBullConnector(),
    ].filter(Boolean);

    const appkit = new StellarAppKit({
      network: "TESTNET",
      connectors,
      appMetadata: APP_METADATA,
    });

    appkitRef.current = appkit;
    return appkit;
  }, []);

  const connect = useCallback(async (connectorId: ConnectorId) => {
    setState((s) => ({ ...s, connecting: true, error: null }));

    try {
      const appkit = await getAppKit();
      const connector = (appkit as { connectors: Map<string, unknown> }).connectors?.get(connectorId)
        ?? (appkit as { registry: { get: (id: string) => unknown } }).registry?.get(connectorId);

      if (!connector) {
        throw new Error(`Connector ${connectorId} not found`);
      }

      // Connect to the wallet
      const connectFn = (appkit as { connect: (opts: { connectorId: string }) => Promise<{ address: string }> }).connect.bind(appkit);
      const result = await connectFn({ connectorId });

      setState({
        address: result.address,
        connected: true,
        connecting: false,
        connector: connectorId,
        error: null,
      });

      return result.address;
    } catch (err) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, [getAppKit]);

  /**
   * §11 — Sign-In With Stellar: wallet signs a message proving ownership.
   * The signed message + nonce are sent to the server for verification.
   */
  const signInWithStellar = useCallback(async (
    address: string,
    statement: string
  ): Promise<{
    message: string;
    signedMessage: string;
    signerAddress: string;
    nonce: string;
  }> => {
    // 1. Fetch nonce from server
    const nonceRes = await fetch("/api/auth/nonce");
    if (!nonceRes.ok) throw new Error("Failed to fetch nonce");
    const { nonce } = await nonceRes.json();

    // 2. Get the appkit client + active connector
    const appkit = await getAppKit();
    const signInFn = (appkit as {
      signIn: (opts: {
        connectorId: string;
        statement: string;
        nonce: string;
      }) => Promise<{
        message: string;
        signedMessage: string;
        signerAddress: string;
        issuedAt: string;
        expirationTime: string;
      }>;
    }).signIn.bind(appkit);

    // 3. Sign the SIWS message with the wallet
    const result = await signInFn({
      connectorId: state.connector!,
      statement,
      nonce,
    });

    return {
      message: result.message,
      signedMessage: result.signedMessage,
      signerAddress: result.signerAddress,
      nonce,
    };
  }, [getAppKit, state.connector]);

  /**
   * §11 — Verify the SIWS signature on the server and save the profile.
   */
  const verifyAndSaveProfile = useCallback(async (siws: {
    message: string;
    signedMessage: string;
    signerAddress: string;
    nonce: string;
  }, profile: {
    username: string;
    displayName?: string;
    bio?: string;
  }) => {
    const res = await fetch("/api/auth/verify-siws", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...siws,
        ...profile,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Verification failed (${res.status})`);
    }

    return res.json();
  }, []);

  const disconnect = useCallback(() => {
    setState({
      address: null,
      connected: false,
      connecting: false,
      connector: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    connect,
    signInWithStellar,
    verifyAndSaveProfile,
    disconnect,
  };
}
