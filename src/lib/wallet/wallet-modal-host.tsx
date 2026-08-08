"use client";

import { useRef, useEffect } from "react";
import {
  StellarAppKitModal,
  useAppKit,
} from "@saganta/stellar-appkit-ui-web/react";
import type { StellarAppKitModalHandle } from "@saganta/stellar-appkit-ui-web/react";
import type { StellarAppKit } from "@saganta/stellar-appkit";
// IMPORTANT: this side-effect import registers the <stellar-appkit-modal>
// custom element. Must be imported once at the app entry.
import "@saganta/stellar-appkit-ui-web";

/**
 * Wallet modal host — mounts the <StellarAppKitModal> with mode="auto"
 * (modal on desktop, bottom-sheet on mobile) and dark theme.
 *
 * Reads its `client` from the StellarAppKitProvider context automatically.
 * Other components open it via the `useWalletModal()` hook below.
 *
 * Theme tokens are overridden to match the Soroban.Build design system.
 */

export function WalletModalHost() {
  const ref = useRef<StellarAppKitModalHandle>(null);
  const appkit = useAppKit();

  // Expose the modal handle AND the appkit client on window so other
  // components can open the modal + call signOut()/disconnect() without
  // being inside the StellarAppKitProvider tree.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __walletModal?: StellarAppKitModalHandle | null }).__walletModal = ref.current;
      (window as unknown as { __appkit?: StellarAppKit | null }).__appkit = appkit;
    }
  }, [appkit]);

  return (
    <StellarAppKitModal
      ref={ref}
      mode="auto"
      theme="dark"
      branding="default"
      title="Soroban.Build"
      logoSrc="/icon.svg"
      stellarExpertAvatars={true}
      autoRetryNetwork={true}
      style={{
        // Override the modal's theme tokens with our app's design system
        "--sak-color-bg": "#0D0E11",
        "--sak-color-surface": "#131418",
        "--sak-color-surface-hover": "#202227",
        "--sak-color-border": "rgba(255,255,255,0.08)",
        "--sak-color-text": "#E6E7EA",
        "--sak-color-text-muted": "#6E7178",
        "--sak-color-accent": "#4F8C8C",
        "--sak-color-accent-text": "#FFFFFF",
        "--sak-color-danger": "#C97A7A",
        "--sak-overlay-color": "rgba(0,0,0,0.5)",
      } as React.CSSProperties}
    />
  );
}

/**
 * Hook to open/close the wallet modal from any component.
 * Works without being inside the provider (uses window.__walletModal).
 */
export function useWalletModal() {
  return {
    open: () => {
      const handle = (window as unknown as { __walletModal?: StellarAppKitModalHandle }).__walletModal;
      handle?.open();
    },
    close: () => {
      const handle = (window as unknown as { __walletModal?: StellarAppKitModalHandle }).__walletModal;
      handle?.close();
    },
  };
}

/**
 * Hook to get the raw StellarAppKit client instance (for signing transactions
 * outside the modal flow — e.g. deploying a contract).
 */
export function useAppKitClient() {
  return useAppKit();
}

/**
 * Sign out + disconnect the wallet from anywhere in the app.
 *
 * Calls appkit.signOut() which:
 *   1. Clears the SIWS session (local + persisted)
 *   2. Calls our siws.signout() callback → POST /api/siws/logout (server)
 *   3. Disconnects the active wallet
 *   4. Fires siwsSessionChange(null) → SiwsSessionBridge clears profile-store
 *
 * Returns true if the call succeeded, false otherwise.
 */
export async function walletSignOut(): Promise<boolean> {
  try {
    const appkit = (window as unknown as { __appkit?: StellarAppKit | null }).__appkit;
    if (!appkit) {
      // Appkit not mounted yet — fall back to clearing local state only
      return false;
    }
    await appkit.signOut();
    return true;
  } catch (err) {
    console.error("[wallet] signOut failed:", err);
    return false;
  }
}

