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
}

interface ProfileState {
  profile: UserProfile | null;
  /** Whether the wallet is currently connected (sc-connect fired, not disconnected) */
  walletConnected: boolean;
  /** Whether the server session check has completed */
  sessionChecked: boolean;
  /** Per-user accent color used for collab cursors and avatars */
  accentColor: string;

  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  setWalletConnected: (connected: boolean) => void;
  isLoggedIn: () => boolean;
  /** Check server session by wallet address */
  syncFromWallet: (address: string | null) => Promise<void>;
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
      sessionChecked: false,
      accentColor: "#4F8C8C",

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
          sessionChecked: true,
          accentColor: "#4F8C8C",
        }),

      setWalletConnected: (connected: boolean) =>
        set((s) => {
          if (!connected) {
            // Wallet disconnected — clear everything
            return { walletConnected: false, profile: null, sessionChecked: true };
          }
          return { walletConnected: true };
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
              },
              accentColor: colorFromAddress(address),
              walletConnected: true,
              sessionChecked: true,
            });
          } else {
            // Wallet connected but no profile in DB — not logged in
            set({ profile: null, sessionChecked: true });
          }
        } catch {
          set({ sessionChecked: true });
        }
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
