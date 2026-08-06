"use client";

import { useState, useCallback, useRef } from "react";

/**
 * §11 — Wallet connection hook using @saganta/stellar-appkit.
 *
 * Wraps the StellarAppKit client with React state management.
 * Supports Freighter, Albedo, xBull connectors.
 *
 * SIWS (Sign-In With Stellar) flow:
 *   1. connect(walletId) — opens wallet, user approves connection
 *   2. signIn({ statement, nonce }) — wallet signs SIWS message
 *   3. verifyAndSaveProfile() — server verifies signature + saves profile
 */

interface WalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  connector: string | null;
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

  const getAppKit = useCallback(async () => {
    if (appkitRef.current) return appkitRef.current;

    const { StellarAppKit, createFreighterConnector, createAlbedoConnector, createXBullConnector } = await import("@saganta/stellar-appkit");
    // Import the web component — registers <saganta-appkit-modal> custom element
    await import("@saganta/stellar-appkit/ui-web");

    const appkit = new StellarAppKit({
      network: "TESTNET",
      connectors: [
        createFreighterConnector(),
        createAlbedoConnector(),
        createXBullConnector(),
      ],
      appMetadata: APP_METADATA,
    });

    appkitRef.current = appkit;

    // Mount the <saganta-appkit-modal> web component with our theme tokens
    if (typeof document !== "undefined") {
      let modal = document.querySelector<HTMLElement>("saganta-appkit-modal");
      if (!modal) {
        modal = document.createElement("saganta-appkit-modal") as HTMLElement;
        modal.setAttribute("theme", "dark");
        modal.setAttribute("mode", "modal");
        modal.setAttribute("title", "Soroban.Build");
        modal.setAttribute("logo-src", "/icon.svg");
        // Override the modal's default theme tokens with our app's design system
        modal.style.setProperty("--sak-color-bg", "#0D0E11");
        modal.style.setProperty("--sak-color-surface", "#131418");
        modal.style.setProperty("--sak-color-surface-hover", "#202227");
        modal.style.setProperty("--sak-color-border", "rgba(255,255,255,0.08)");
        modal.style.setProperty("--sak-color-text", "#E6E7EA");
        modal.style.setProperty("--sak-color-text-muted", "#6E7178");
        modal.style.setProperty("--sak-color-accent", "#4F8C8C");
        modal.style.setProperty("--sak-color-accent-text", "#FFFFFF");
        modal.style.setProperty("--sak-color-danger", "#C97A7A");
        modal.style.setProperty("--sak-overlay-color", "rgba(0,0,0,0.5)");
        document.body.appendChild(modal);
      }
      // Attach the client instance to the modal
      (modal as unknown as { client: unknown }).client = appkit;
    }

    return appkit;
  }, []);

  const connect = useCallback(async (walletId: string) => {
    setState((s) => ({ ...s, connecting: true, error: null }));

    try {
      const appkit = await getAppKit();

      // appkit.connect(walletId) — opens the wallet extension
      // Add a 30s timeout — if the wallet doesn't respond, show an error
      const session = await Promise.race([
        appkit.connect(walletId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${walletId} did not respond. Make sure the wallet extension is installed and unlocked.`)), 30_000)
        ),
      ]);

      setState({
        address: session.address,
        connected: true,
        connecting: false,
        connector: walletId,
        error: null,
      });

      return session.address;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        connecting: false,
        error: msg,
      }));
      throw err;
    }
  }, [getAppKit]);

  /**
   * §11 — Sign-In With Stellar: wallet signs a message proving ownership.
   */
  const signInWithStellar = useCallback(async (
    _address: string,
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

    // 2. Get the appkit client
    const appkit = await getAppKit();

    // 3. Sign the SIWS message — appkit.signIn() uses the active connector
    const result = await appkit.signIn({
      statement,
      nonce,
    });

    // Debug: log the EXACT message that was signed
    console.log("[SIWS Client] Message signed:", {
      messageLength: result.message.length,
      messageBytes: new TextEncoder().encode(result.message).length,
      messagePreview: result.message.substring(0, 100),
      messageFull: result.message,
      signedMessageLength: result.signedMessage.length,
      signedMessagePreview: result.signedMessage.substring(0, 40),
      hasSignedData: !!result.signedData,
      signerAddress: result.signerAddress,
      nonce,
    });

    return {
      message: result.message,
      signedMessage: result.signedMessage,
      signerAddress: result.signerAddress,
      nonce,
      // signedData is the SEP-0053 hash (base64) for Freighter — the server
      // needs this to verify the signature correctly.
      signedData: result.signedData,
    };
  }, [getAppKit]);

  /**
   * §11 — Verify the SIWS signature on the server and save the profile.
   */
  const verifyAndSaveProfile = useCallback(async (siws: {
    message: string;
    signedMessage: string;
    signerAddress: string;
    nonce: string;
    signedData?: string;
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
      // Include the reason from the server for better error messages
      const msg = err.reason
        ? `${err.error}: ${err.reason}`
        : err.error ?? `Verification failed (${res.status})`;
      throw new Error(msg);
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

  /** Open the <saganta-appkit-modal> wallet picker */
  const openWalletModal = useCallback(async () => {
    await getAppKit(); // ensures the modal is mounted with client attached
    if (typeof document !== "undefined") {
      const modal = document.querySelector<HTMLElement & { open: () => void }>("saganta-appkit-modal");
      modal?.open?.();
    }
  }, [getAppKit]);

  /** Get the appkit instance (ensures modal is mounted with client) */
  const getAppKitInstance = useCallback(async () => {
    return getAppKit();
  }, [getAppKit]);

  return {
    ...state,
    connect,
    openWalletModal,
    getAppKitInstance,
    signInWithStellar,
    verifyAndSaveProfile,
    disconnect,
  };
}
