"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ProviderId } from "@/lib/ai/providers";

/**
 * §9.1 / §9.2 — BYOK (Bring Your Own Key) storage.
 *
 * Keys are stored ONLY in browser storage (localStorage for now; production
 * should use IndexedDB with encryption-at-rest). Keys NEVER go to our server
 * except as part of the direct provider call (or proxied call for CORS-blocked
 * providers per §9.10) — never stored, never logged.
 *
 * Per-provider config:
 *   - apiKey
 *   - model (selected from listModels() or manually entered)
 *   - customModels (manually-typed model namesillitant listModels fails)
 *   - baseUrl (for custom-openai provider)
 *   - enabled (whether this provider shows up in the agent's provider picker)
 */

export interface ProviderConfig {
  apiKey: string;
  model: string;
  customModel?: string; // manually typed, used if model === "__custom__"
  baseUrl?: string; // for custom-openai
  enabled: boolean;
  lastValidatedAt?: number;
}

interface AIKeysState {
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  activeProviderId: ProviderId | null;
  /** §9.5 — 'Allow always' toggle for agent diff approvals */
  allowAlways: boolean;
  /** §9.9 — per-request token budget cap */
  tokenBudget: number;

  setProvider: (id: ProviderId, config: Partial<ProviderConfig>) => void;
  removeProvider: (id: ProviderId) => void;
  setActiveProvider: (id: ProviderId | null) => void;
  setAllowAlways: (v: boolean) => void;
  setTokenBudget: (n: number) => void;
  getActiveConfig: () => { id: ProviderId; config: ProviderConfig } | null;
}

export const useAIKeysStore = create<AIKeysState>()(
  persist(
    (set, get) => ({
      providers: {},
      activeProviderId: null,
      allowAlways: false,
      tokenBudget: 32000,

      setProvider: (id, config) =>
        set((s) => ({
          providers: {
            ...s.providers,
            [id]: {
              apiKey: "",
              model: "",
              enabled: true,
              ...s.providers[id],
              ...config,
            },
          },
        })),

      removeProvider: (id) =>
        set((s) => {
          const newProviders = { ...s.providers };
          delete newProviders[id];
          const newActive =
            s.activeProviderId === id ? null : s.activeProviderId;
          return { providers: newProviders, activeProviderId: newActive };
        }),

      setActiveProvider: (id) => set({ activeProviderId: id }),

      setAllowAlways: (v) => set({ allowAlways: v }),
      setTokenBudget: (n) => set({ tokenBudget: n }),

      getActiveConfig: () => {
        const { activeProviderId, providers } = get();
        if (!activeProviderId) return null;
        const config = providers[activeProviderId];
        if (!config || !config.apiKey) return null;
        return { id: activeProviderId, config };
      },
    }),
    {
      name: "stellarforge:ai-keys",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        providers: s.providers,
        activeProviderId: s.activeProviderId,
        allowAlways: s.allowAlways,
        tokenBudget: s.tokenBudget,
      }),
    }
  )
);
