"use client";

import { useEffect, useRef } from "react";
import { useStellarWallet } from "@/lib/wallet/use-stellar-wallet";

/**
 * Lazy-loaded wallet mount component.
 *
 * This component is only loaded when the user clicks Connect, which
 * triggers Turbopack to compile @saganta/stellar-appkit (and all its
 * heavy dependencies) on-demand instead of during initial page load.
 *
 * It creates the StellarAppKit client, mounts the <saganta-appkit-modal>
 * web component with the client attached, and opens the modal.
 */
export function WalletMount() {
  const wallet = useStellarWallet();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    (async () => {
      try {
        // This creates the StellarAppKit instance AND mounts the modal
        // with .client set, then opens it
        await wallet.openWalletModal();
      } catch {
        // Silently fail
      }
    })();
  }, [wallet]);

  return null;
}
