"use client";

import { StellarAppKitProvider } from "@saganta/stellar-appkit-ui-web/react";
import type { StellarAppKitProviderConfig } from "@saganta/stellar-appkit-ui-web/react";
import type { ReactNode } from "react";

/**
 * StellarAppKit React provider — owns the single StellarAppKit instance
 * for the whole app and wires up the built-in SIWS (Sign-In With Stellar)
 * automatic authentication flow.
 *
 * Flow (all handled by the SDK once `siws` is configured):
 *   1. User clicks "Connect" → <StellarAppKitModal>.open()
 *   2. Wallet connects → SDK fires `connect` event
 *   3. SDK calls siws.session(address) → if valid session exists, skip sign-in
 *   4. SDK calls siws.nonce() → server issues a one-time nonce
 *   5. SDK calls appkit.signIn({ statement, nonce }) → wallet signs SIWS msg
 *   6. SDK calls siws.verify(result, nonce, ctx) → server verifies + returns SiwsSession
 *   7. SDK validates the returned session (address + network match) → stores it
 *   8. Components read it via useSiwsSession() / useIsAuthenticated()
 *
 * On disconnect: SDK calls siws.signout() first, then disconnects the wallet.
 */

const APP_METADATA = {
  name: "StellarForge",
  description: "Agentic Web IDE for Soroban Smart Contracts",
  // url is auto-derived from window.location.origin in the browser
};

const config: StellarAppKitProviderConfig = {
  network: "TESTNET",
  appMetadata: APP_METADATA,
  restoreOnMount: true,

  // Built-in SIWS — the modal auto-triggers sign-in after wallet connect.
  // All four callbacks hit our server endpoints under /api/siws/*.
  siws: {
    statement: "Sign in to StellarForge",
    signoutOnDisconnect: true, // call /logout before disconnecting
    disconnectOnFail: true, // disconnect wallet if SIWS fails + modal closed
    maxRetries: 3,
    timeoutMs: 30_000,

    // Check for an existing server-side session (skips sign-in if valid).
    // The SDK calls this with no args — we read the connected wallet's
    // address from the appkit's persisted session in localStorage.
    session: async () => {
      try {
        const raw = localStorage.getItem("saganta-connect:session");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // The storage format is { sessions: [{ address, ... }], activeWalletId }
        // or { address, ... } depending on version — handle both
        const address =
          parsed?.address ??
          parsed?.sessions?.[0]?.address ??
          parsed?.activeSession?.address;
        if (!address) return null;
        const res = await fetch(
          `/api/siws/session?address=${encodeURIComponent(address)}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data ?? null;
      } catch {
        return null;
      }
    },

    // Fetch a one-time nonce from the server
    nonce: async () => {
      const res = await fetch("/api/siws/nonce");
      if (!res.ok) throw new Error("Failed to fetch nonce");
      // Server returns plain text
      return res.text();
    },

    // Verify the SIWS signature on the server + create the session
    verify: async (data, nonce, context) => {
      const res = await fetch("/api/siws/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: data.message,
          signedMessage: data.signedMessage,
          signerAddress: data.signerAddress,
          signedData: data.signedData,
          issuedAt: data.issuedAt,
          expirationTime: data.expirationTime,
          nonce,
          context,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || err.reason || `Verify failed (${res.status})`);
      }
      return res.json();
    },

    // Log out — clears the server-side session. The SDK calls this with no
    // args; we read the address from localStorage (same as session()).
    signout: async () => {
      try {
        let address: string | undefined;
        try {
          const raw = localStorage.getItem("saganta-connect:session");
          if (raw) {
            const parsed = JSON.parse(raw);
            address =
              parsed?.address ??
              parsed?.sessions?.[0]?.address ??
              parsed?.activeSession?.address;
          }
        } catch {
          // ignore
        }
        await fetch("/api/siws/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        });
      } catch {
        // best-effort
      }
      return true;
    },
  },
};

export function AppKitProvider({ children }: { children: ReactNode }) {
  return (
    <StellarAppKitProvider config={config}>{children}</StellarAppKitProvider>
  );
}
