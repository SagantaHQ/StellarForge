"use client";

import { useEffect, useRef } from "react";
import { useSiwsSession, useSession, useAppKit } from "@saganta/stellar-appkit-ui-web/react";
import { useProfileStore } from "@/stores/profile-store";

/**
 * Bridge between the stellar-appkit SDK's SIWS session state and our
 * Zustand profile-store.
 *
 * Mount this once inside the <StellarAppKitProvider>. It:
 *   1. Watches `useSiwsSession()` — when the SDK sets/clears the session,
 *      calls `profileStore.syncFromSiwsSession(session)` to update the
 *      profile, walletConnected, and walletAddress.
 *   2. Watches `useSession()` — when the wallet connects/disconnects
 *      (without SIWS), updates `walletConnected` + `walletAddress` so
 *      the TopBar can show the right state.
 *   3. On mount, restores from any persisted SIWS session.
 *
 * This replaces the old manual `sc-connect` / `sc-disconnect` event
 * listeners in ide-shell.tsx.
 */
export function SiwsSessionBridge() {
  const siwsSession = useSiwsSession();
  const walletSession = useSession();
  const appkit = useAppKit();
  const syncFromSiwsSession = useProfileStore((s) => s.syncFromSiwsSession);
  const setWalletConnected = useProfileStore((s) => s.setWalletConnected);
  const lastSyncedAddress = useRef<string | null>(null);

  // Sync SIWS session changes → profile store
  useEffect(() => {
    if (siwsSession) {
      // Only sync if the address changed (avoid redundant syncs)
      if (lastSyncedAddress.current !== siwsSession.address) {
        lastSyncedAddress.current = siwsSession.address;
        syncFromSiwsSession({
          address: siwsSession.address,
          network: siwsSession.network,
          expiry: siwsSession.expiry,
          metadata: siwsSession.metadata,
        });
      }
    } else {
      // Session cleared
      if (lastSyncedAddress.current !== null) {
        lastSyncedAddress.current = null;
        syncFromSiwsSession(null);
      }
    }
  }, [siwsSession, syncFromSiwsSession]);

  // Sync wallet connection state (wallet connected but SIWS may be pending)
  useEffect(() => {
    if (walletSession?.address) {
      setWalletConnected(true, walletSession.address);
    }
    // Don't clear on null — the SIWS session effect handles that
  }, [walletSession?.address, setWalletConnected]);

  // Listen for the appkit's siwsSessionChange event as a backup
  // (in case the hook doesn't fire on edge cases like session expiry)
  useEffect(() => {
    if (!appkit?.on) return;
    const handler = (session: unknown) => {
      if (!session) {
        lastSyncedAddress.current = null;
        syncFromSiwsSession(null);
      }
    };
    appkit.on("siwsSessionChange", handler as never);
    // StellarAppKit doesn't expose an off() method — the listener is
    // cleaned up when the provider unmounts (app lifetime).
    return () => {
      // no-op — appkit.on listeners persist for the app lifetime
    };
  }, [appkit, syncFromSiwsSession]);

  return null;
}
