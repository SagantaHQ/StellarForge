"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * §11 — User profile store.
 *
 * After wallet connect, the user is identified by:
 *   - address (Stellar wallet address, e.g. G...)
 *   - username (unique, used in collab/comments/line attribution)
 *   - avatarUrl, bio (optional)
 *
 * The username is the identity used in live sharing sessions, line attribution,
 * comments, and presence.
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
  /** Per-user accent color used for collab cursors and avatars */
  accentColor: string;

  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  isLoggedIn: () => boolean;
}

// Deterministic accent color from address
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
      accentColor: "#4F8C8C",

      setProfile: (p) =>
        set({ profile: p, accentColor: colorFromAddress(p.address) }),

      clearProfile: () => set({ profile: null, accentColor: "#4F8C8C" }),

      isLoggedIn: () => !!get().profile,
    }),
    {
      name: "soroban-build:profile",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
