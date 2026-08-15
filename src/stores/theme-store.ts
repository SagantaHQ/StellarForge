"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  BUILT_IN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getThemeById,
} from "@/lib/themes/registry";
import type { ThemeDefinition } from "@/lib/themes/types";

interface ThemeState {
  /** Active theme ID — drives CSS variables, Monaco theme, xterm theme */
  themeId: string;
  /** User's preferred mode (used to pick default on first visit) */
  preferredMode: "dark" | "light";
  /** User-installed themes (in addition to built-ins) */
  customThemes: ThemeDefinition[];
  /** Font size for Monaco editor */
  editorFontSize: number;
  /** Whether to use prefers-color-scheme on first visit (cleared after first explicit pick) */
  respectsSystemPreference: boolean;

  setTheme: (id: string) => void;
  toggleMode: () => void;
  setPreferredMode: (mode: "dark" | "light") => void;
  registerCustomTheme: (theme: ThemeDefinition) => void;
  removeCustomTheme: (id: string) => void;
  setEditorFontSize: (size: number) => void;
  getActiveTheme: () => ThemeDefinition;
  getAllThemes: () => ThemeDefinition[];
}

function detectInitialMode(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function detectInitialThemeId(): string {
  return DEFAULT_DARK_THEME_ID;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: detectInitialThemeId(),
      preferredMode: detectInitialMode(),
      customThemes: [],
      editorFontSize: 13,
      respectsSystemPreference: false,

      setTheme: (id) =>
        set({ themeId: id, respectsSystemPreference: false }),

      toggleMode: () => {
        const current = get().preferredMode;
        const next = current === "dark" ? "light" : "dark";
        const nextThemeId = next === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
        set({
          preferredMode: next,
          themeId: nextThemeId,
          respectsSystemPreference: false,
        });
      },

      setPreferredMode: (mode) =>
        set({
          preferredMode: mode,
          themeId: mode === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID,
          respectsSystemPreference: false,
        }),

      registerCustomTheme: (theme) =>
        set((s) => ({
          customThemes: [...s.customThemes.filter((t) => t.id !== theme.id), theme],
        })),

      removeCustomTheme: (id) =>
        set((s) => ({ customThemes: s.customThemes.filter((t) => t.id !== id) })),

      setEditorFontSize: (size) => set({ editorFontSize: size }),

      getActiveTheme: () => {
        const { themeId, customThemes } = get();
        return (
          getThemeById(themeId) ||
          customThemes.find((t) => t.id === themeId) ||
          BUILT_IN_THEMES[0]
        );
      },

      getAllThemes: () => {
        const { customThemes } = get();
        return [...BUILT_IN_THEMES, ...customThemes];
      },
    }),
    {
      name: "stellarforge:theme",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        themeId: s.themeId,
        preferredMode: s.preferredMode,
        customThemes: s.customThemes,
        editorFontSize: s.editorFontSize,
        respectsSystemPreference: s.respectsSystemPreference,
      }),
    }
  )
);
