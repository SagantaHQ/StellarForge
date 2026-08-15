"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * §11 — User profile store with server session validation.
 *
 * Two conditions must BOTH be true for the user to be "logged in":
 *   1. walletConnected — the wallet extension is connected (sc-connect fired)
 *   2. profile — the server session says this address has a profile
 *
 * If either is false, the TopBar shows "Connect" instead of the avatar.
 * All cloud features (comments, collab, line attribution) check isLoggedIn().
 */

export interface UserProfile {
  address: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
  createdAt: number;
  isCustomUsername?: boolean;
}

interface ProfileState {
  profile: UserProfile | null;
  /** Whether the wallet is currently connected (sc-connect fired, not disconnected) */
  walletConnected: boolean;
  /** The connected wallet address (available even before profile is created) */
  walletAddress: string | null;
  /** Whether the server session check has completed */
  sessionChecked: boolean;
  /** Per-user accent color used for collab cursors and avatars */
  accentColor: string;
  /** GitHub integration state — synced from /api/github/status */
  githubConnected: boolean;
  githubUsername: string | null;

  /** Whether the SIWS session has been validated against the server */
  siwsValidated: boolean;

  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  setWalletConnected: (connected: boolean, address?: string | null) => void;
  isLoggedIn: () => boolean;
  /** Check server session by wallet address (passive check, no SIWS) */
  syncFromWallet: (address: string | null) => Promise<void>;
  /**
   * New SIWS flow — sync from a SiwsSession returned by the stellar-appkit
   * SDK's verify() callback. The session contains { address, network, expiry, metadata }
   * where metadata has { username, displayName, avatarUrl, bio, isCustomUsername }.
   */
  syncFromSiwsSession: (session: {
    address: string;
    network: string;
    expiry: number;
    metadata?: Record<string, unknown>;
  } | null) => void;
  /** Full login flow: SIWS sign → verify on server → create session. Returns needsProfile flag. */
  loginWithSiws: (siwsResult: {
    message: string;
    signedMessage: string;
    signerAddress: string;
    nonce: string;
    signedData?: string;
  }) => Promise<{ loggedIn: boolean; needsProfile: boolean }>;
  /** Check GitHub connection status (called after profile loads + after OAuth callback) */
  syncGithubStatus: () => Promise<void>;
  /** Disconnect GitHub (clears the token on the server) */
  disconnectGithub: () => Promise<void>;
}

function colorFromAddress(addr: string): string {
  const palette = [
    "#4F8C8C", "#C5794B", "#7B96B3", "#6FA885",
    "#A88FB3", "#C9A66B", "#D29464", "#9A88A8",
  ];
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = ((hash << 5) - hash) + addr.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      walletConnected: false, // starts false — wallet not connected on fresh page load
      walletAddress: null,
      sessionChecked: false,
      siwsValidated: false, // starts false — validated when SIWS session confirmed
      accentColor: "#4F8C8C",
      githubConnected: false,
      githubUsername: null,

      setProfile: (p) =>
        set({
          profile: p,
          walletConnected: true, // profile set means wallet was connected
          accentColor: colorFromAddress(p.address),
          sessionChecked: true,
        }),

      clearProfile: () => {
        // Call the server signout endpoint (fire-and-forget) to clear the
        // server-side SIWS session. This ensures the user is fully logged
        // out on both client + server.
        const address = get().profile?.address ?? get().walletAddress;
        if (address) {
          fetch("/api/siws/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
          }).catch(() => {});
        }
        set({
          profile: null,
          walletConnected: false,
          walletAddress: null,
          sessionChecked: true,
          siwsValidated: false,
          accentColor: "#4F8C8C",
          githubConnected: false,
          githubUsername: null,
        });
      },

      setWalletConnected: (connected: boolean, address?: string | null) =>
        set((s) => {
          if (!connected) {
            // Wallet disconnected — clear everything
            return {
              walletConnected: false,
              walletAddress: null,
              profile: null,
              sessionChecked: true,
              githubConnected: false,
              githubUsername: null,
            };
          }
          return {
            walletConnected: true,
            walletAddress: address ?? s.walletAddress,
          };
        }),

      // BOTH conditions must be true: wallet connected AND server profile exists
      // AND SIWS session has been validated against the server.
      // This prevents showing "logged in" when the wallet isn't actually connected
      // (e.g. persisted profile but wallet extension disconnected).
      isLoggedIn: () => get().walletConnected && !!get().profile && get().sessionChecked && get().siwsValidated,

      syncFromWallet: async (address: string | null) => {
        if (!address) {
          set({ profile: null, walletConnected: false, sessionChecked: true });
          return;
        }

        // Wallet is connected — set flag
        set({ walletConnected: true });

        try {
          const res = await fetch(`/api/auth/session?address=${encodeURIComponent(address)}`);
          if (!res.ok) {
            set({ profile: null, sessionChecked: true });
            return;
          }
          const data = await res.json();
          if (data.loggedIn && data.profile) {
            set({
              profile: {
                address,
                username: data.profile.username,
                avatarUrl: data.profile.avatarUrl ?? undefined,
                bio: data.profile.bio ?? undefined,
                createdAt: Date.now(),
                isCustomUsername: data.profile.isCustomUsername ?? true,
              },
              accentColor: colorFromAddress(address),
              walletConnected: true,
              walletAddress: address,
              sessionChecked: true,
            });
          } else {
            // Wallet connected but no profile in DB — not logged in
            set({ profile: null, sessionChecked: true });
          }
        } catch {
          set({ sessionChecked: true });
        }

        // After session sync, also check GitHub status
        get().syncGithubStatus();
      },

      // New SIWS flow — called when the stellar-appkit SDK fires
      // `siwsSessionChange`. The session is set by the SDK after verify()
      // returns a valid SiwsSession, or cleared on disconnect/expiry.
      syncFromSiwsSession: (session) => {
        if (!session) {
          // Session cleared — user signed out or session expired
          set({
            profile: null,
            walletConnected: false,
            walletAddress: null,
            sessionChecked: true,
            siwsValidated: false,
            githubConnected: false,
            githubUsername: null,
          });
          return;
        }

        const address = session.address;
        const meta = (session.metadata ?? {}) as {
          username?: string;
          displayName?: string | null;
          avatarUrl?: string | null;
          bio?: string | null;
          isCustomUsername?: boolean;
        };

        set({
          walletConnected: true,
          walletAddress: address,
          sessionChecked: true,
          siwsValidated: true, // SIWS session confirmed → validated
          accentColor: colorFromAddress(address),
          profile: {
            address,
            username: meta.username ?? "",
            avatarUrl: meta.avatarUrl ?? undefined,
            bio: meta.bio ?? undefined,
            createdAt: Date.now(),
            isCustomUsername: meta.isCustomUsername ?? false,
          },
        });

        // Sync GitHub status in the background
        get().syncGithubStatus();
      },

      loginWithSiws: async (siwsResult) => {
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(siwsResult),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            set({ sessionChecked: true });
            return { loggedIn: false, needsProfile: true };
          }

          const data = await res.json();

          if (data.loggedIn) {
            if (data.profile) {
              // User has a profile — fully logged in
              set({
                profile: {
                  address: siwsResult.signerAddress,
                  username: data.profile.username,
                  avatarUrl: data.profile.avatarUrl ?? undefined,
                  bio: data.profile.bio ?? undefined,
                  createdAt: Date.now(),
                  isCustomUsername: data.profile.isCustomUsername ?? true,
                },
                accentColor: colorFromAddress(siwsResult.signerAddress),
                walletConnected: true,
                sessionChecked: true,
              });
              // Check GitHub status
              get().syncGithubStatus();
              return { loggedIn: true, needsProfile: false };
            } else {
              // Logged in but no profile — need to complete registration
              set({
                profile: null,
                walletConnected: true,
                sessionChecked: true,
              });
              return { loggedIn: true, needsProfile: true };
            }
          }

          set({ sessionChecked: true });
          return { loggedIn: false, needsProfile: true };
        } catch {
          set({ sessionChecked: true });
          return { loggedIn: false, needsProfile: true };
        }
      },

      syncGithubStatus: async () => {
        const address = get().profile?.address;
        if (!address) {
          set({ githubConnected: false, githubUsername: null });
          return;
        }
        try {
          const res = await fetch(
            `/api/github/status?walletAddress=${encodeURIComponent(address)}`
          );
          if (!res.ok) {
            set({ githubConnected: false, githubUsername: null });
            return;
          }
          const data = await res.json();
          set({
            githubConnected: !!data.connected,
            githubUsername: data.username ?? null,
          });
        } catch {
          set({ githubConnected: false, githubUsername: null });
        }
      },

      disconnectGithub: async () => {
        const address = get().profile?.address;
        if (!address) return;
        try {
          await fetch(
            `/api/github/status?walletAddress=${encodeURIComponent(address)}`,
            { method: "DELETE" }
          );
        } catch {
          // Best-effort
        }
        set({ githubConnected: false, githubUsername: null });
      },
    }),
    {
      name: "stellarforge:profile",
      storage: createJSONStorage(() => localStorage),
      // CRITICAL: Do NOT persist walletConnected, profile, or siwsValidated.
      //
      // Previously we persisted walletConnected + profile so the UI showed
      // the avatar immediately on page load. But this caused a bug: the user
      // appeared "logged in" even when the wallet wasn't actually connected
      // (e.g. wallet extension closed, storage cleared, different browser).
      //
      // Now we only persist:
      //   - accentColor (cosmetic, safe to restore)
      //   - githubConnected + githubUsername (set after OAuth, not wallet-dependent)
      //
      // On page load:
      //   - walletConnected starts false
      //   - profile starts null
      //   - siwsValidated starts false
      //   - The SiwsSessionBridge + SDK restore() verify the wallet is actually
      //     connected before setting these to true
      //   - If the wallet isn't connected within 15s, the user stays logged out
      partialize: (s) => ({
        accentColor: s.accentColor,
        githubConnected: s.githubConnected,
        githubUsername: s.githubUsername,
      }),
    }
  )
);
