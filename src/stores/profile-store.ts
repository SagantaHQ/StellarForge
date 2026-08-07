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

  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  setWalletConnected: (connected: boolean, address?: string | null) => void;
  isLoggedIn: () => boolean;
  /** Check server session by wallet address (passive check, no SIWS) */
  syncFromWallet: (address: string | null) => Promise<void>;
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

      clearProfile: () =>
        set({
          profile: null,
          walletConnected: false,
          walletAddress: null,
          sessionChecked: true,
          accentColor: "#4F8C8C",
          githubConnected: false,
          githubUsername: null,
        }),

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
      isLoggedIn: () => get().walletConnected && !!get().profile && get().sessionChecked,

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
      name: "soroban-build:profile",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        profile: s.profile,
        accentColor: s.accentColor,
        // Don't persist walletConnected — always start as false on page load.
        // The wallet's auto-restore will fire sc-connect which sets it true.
      }),
    }
  )
);
