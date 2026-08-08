"use client";

import { useRef, useEffect } from "react";
import {
  StellarAppKitModal,
  useAppKit,
} from "@saganta/stellar-appkit-ui-web/react";
import type { StellarAppKitModalHandle } from "@saganta/stellar-appkit-ui-web/react";
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

  // Expose the modal handle on window so other components can open it
  // without using context (e.g. from the TopBar's Connect button).
  // We use a useEffect to set this after mount so the ref is populated.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __walletModal?: StellarAppKitModalHandle | null }).__walletModal = ref.current;
    }
  }, []);

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
