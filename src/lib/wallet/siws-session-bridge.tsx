"use client";

import { useEffect, useRef } from "react";
import { useSiwsSession, useSession, useAppKit } from "@saganta/stellar-appkit-ui-web/react";
import { useProfileStore } from "@/stores/profile-store";

/**
 * Bridge between the stellar-appkit SDK's SIWS session state and our
 * Zustand profile-store.
 *
 * Mount this once inside the <StellarAppKitProvider>. It:
 *   1. On mount, optimistically restores wallet state from localStorage
 *      so the UI shows the avatar immediately (before the SDK finishes
 *      its async restore).
 *   2. Watches `useSiwsSession()` — when the SDK sets/clears the session,
 *      calls `profileStore.syncFromSiwsSession(session)`.
 *   3. Watches `useSession()` — when the wallet connects/disconnects,
 *      updates `walletConnected` + `walletAddress`.
 *   4. Retries `appkit.restore()` after 3s if no session was restored
 *      (handles the case where the wallet extension wasn't ready on
 *      first mount — e.g. Freighter still loading).
 *   5. After 10s, gives up and sets `sessionChecked=true` so the UI
 *      doesn't hang in a "checking" state forever.
 */

const SIWS_STORAGE_KEY = "saganta-appkit:siws-session";
const WALLET_STORAGE_KEY = "saganta-connect:session";

/** Read the persisted SIWS session from localStorage (if any). */
function readPersistedSiwsSession(): { address: string; network: string; expiry: number; metadata?: Record<string, unknown> } | null {
  try {
    const raw = localStorage.getItem(SIWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.address || !parsed?.expiry) return null;
    if (parsed.expiry <= Date.now()) return null; // expired
    return parsed;
  } catch {
    return null;
  }
}

/** Read the persisted wallet address from localStorage (if any). */
function readPersistedWalletAddress(): string | null {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (
      parsed?.address ??
      parsed?.sessions?.[0]?.address ??
      parsed?.activeSession?.address ??
      null
    );
  } catch {
    return null;
  }
}

export function SiwsSessionBridge() {
  const siwsSession = useSiwsSession();
  const walletSession = useSession();
  const appkit = useAppKit();
  const syncFromSiwsSession = useProfileStore((s) => s.syncFromSiwsSession);
  const setWalletConnected = useProfileStore((s) => s.setWalletConnected);
  const lastSyncedAddress = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. Optimistic restore on mount ──────────────────────────────────
  // Read the persisted SIWS session + wallet address from localStorage
  // and set the profile-store immediately, so the UI shows the avatar
  // before the SDK finishes its async restore().
  useEffect(() => {
    const persistedSession = readPersistedSiwsSession();
    const persistedAddress = readPersistedWalletAddress();

    if (persistedSession) {
      // Optimistically set the profile from the persisted SIWS session
      lastSyncedAddress.current = persistedSession.address;
      syncFromSiwsSession(persistedSession);
    } else if (persistedAddress) {
      // Wallet was connected but no SIWS session — set walletConnected
      // so the UI at least shows the right state
      setWalletConnected(true, persistedAddress);
    }
  }, [syncFromSiwsSession, setWalletConnected]);

  // ── 2. Sync SIWS session changes → profile store ───────────────────
  useEffect(() => {
    if (siwsSession) {
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
      // Session cleared — but only clear if we previously had one
      // (avoid clearing on initial mount before restore completes)
      if (lastSyncedAddress.current !== null) {
        // Check if there's still a persisted session in localStorage
        // (the SDK might have just not loaded it yet)
        const persisted = readPersistedSiwsSession();
        if (!persisted) {
          lastSyncedAddress.current = null;
          syncFromSiwsSession(null);
        }
      }
    }
  }, [siwsSession, syncFromSiwsSession]);

  // ── 3. Sync wallet connection state ────────────────────────────────
  useEffect(() => {
    if (walletSession?.address) {
      setWalletConnected(true, walletSession.address);
    }
    // Don't clear on null — the SIWS session effect handles that
  }, [walletSession?.address, setWalletConnected]);

  // ── 4. Retry restore after 3s (wallet extension might not be ready) ─
  useEffect(() => {
    // If we already have a session, no need to retry
    if (siwsSession) return;

    // Schedule a retry after 3 seconds
    retryTimerRef.current = setTimeout(() => {
      // Check again before retrying
      if (appkit?.siwsSession) return;
      // Call restore() again — the wallet extension might be ready now
      appkit?.restore?.().catch(() => {
        // Silent — restore is safe to call
      });
    }, 3000);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [appkit, siwsSession]);

  // ── 5. Give up after 10s — set sessionChecked so UI doesn't hang ───
  useEffect(() => {
    giveUpTimerRef.current = setTimeout(() => {
      const { sessionChecked } = useProfileStore.getState();
      if (!sessionChecked) {
        useProfileStore.setState({ sessionChecked: true });
      }
    }, 10_000);

    return () => {
      if (giveUpTimerRef.current) clearTimeout(giveUpTimerRef.current);
    };
  }, []);

  // ── 6. Listen for siwsSessionChange events (backup) ────────────────
  useEffect(() => {
    if (!appkit?.on) return;
    const handler = (session: unknown) => {
      if (!session) {
        // Only clear if there's no persisted session
        const persisted = readPersistedSiwsSession();
        if (!persisted) {
          lastSyncedAddress.current = null;
          syncFromSiwsSession(null);
        }
      }
    };
    appkit.on("siwsSessionChange", handler as never);
    return () => {
      // no-op — appkit.on listeners persist for the app lifetime
    };
  }, [appkit, syncFromSiwsSession]);

  return null;
}
