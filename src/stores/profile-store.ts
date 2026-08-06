"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * §11 — User profile store with server session validation.
 *
 * On mount, checks the server session API to see if the user is logged in.
 * All cloud features (comments, collab, line attribution) should check
 * `isLoggedIn()` before operating.
 *
 * The session is validated server-side — the client can't fake it.
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
  /** Whether the server session check has completed */
  sessionChecked: boolean;
  /** Per-user accent color used for collab cursors and avatars */
  accentColor: string;

  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  isLoggedIn: () => boolean;
  /** Check server session — called on mount */
  checkSession: (address: string) => Promise<void>;
  /** Check server session by wallet address from useSession() */
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
      sessionChecked: false,
      accentColor: "#4F8C8C",

      setProfile: (p) => {
        set({ profile: p, accentColor: colorFromAddress(p.address), sessionChecked: true });
        // Also persist to localStorage for instant load on refresh
      },

      clearProfile: () => set({ profile: null, sessionChecked: true, accentColor: "#4F8C8C" }),

      isLoggedIn: () => !!get().profile && get().sessionChecked,

      checkSession: async (address: string) => {
        try {
          const res = await fetch(`/api/auth/session?address=${encodeURIComponent(address)}`);
          if (!res.ok) {
            set({ sessionChecked: true, profile: null });
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
              sessionChecked: true,
            });
          } else {
            // Wallet connected but no profile — not logged in
            set({ profile: null, sessionChecked: true });
          }
        } catch {
          set({ sessionChecked: true });
        }
      },

      syncFromWallet: async (address: string | null) => {
        if (!address) {
          set({ profile: null, sessionChecked: true });
          return;
        }
        await get().checkSession(address);
      },
    }),
    {
      name: "soroban-build:profile",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        profile: s.profile,
        accentColor: s.accentColor,
      }),
    }
  )
);
