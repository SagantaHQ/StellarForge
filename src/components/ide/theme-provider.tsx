"use client";

import { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/theme-store";
import type { ThemeTokens } from "@/lib/themes/types";

/**
 * Maps a ThemeDefinition's tokens onto CSS variables on :root.
 * Called whenever the active theme changes — applies instantly, no reload.
 *
 * §4.1: app chrome, Monaco editor, terminal, diff views all read from these vars.
 */
function applyTokensToCSS(tokens: ThemeTokens) {
  const root = document.documentElement;
  const map: Record<string, string> = {
    "--surface-app": tokens.surfaceApp,
    "--surface-panel": tokens.surfacePanel,
    "--surface-raised": tokens.surfaceRaised,
    "--surface-sunken": tokens.surfaceSunken,
    "--surface-hover": tokens.surfaceHover,
    "--surface-active": tokens.surfaceActive,
    "--border-subtle": tokens.borderSubtle,
    "--border-strong": tokens.borderStrong,
    "--border-input": tokens.borderInput,
    "--text-primary": tokens.textPrimary,
    "--text-secondary": tokens.textSecondary,
    "--text-muted": tokens.textMuted,
    "--text-disabled": tokens.textDisabled,
    "--accent": tokens.accent,
    "--accent-hover": tokens.accentHover,
    "--accent-active": tokens.accentActive,
    "--accent-contrast": tokens.accentContrast,
    "--accent-subtle": hexToRgba(tokens.accent, 0.16),
    "--status-success": tokens.statusSuccess,
    "--status-warning": tokens.statusWarning,
    "--status-error": tokens.statusError,
    "--status-info": tokens.statusInfo,
    "--priority-urgent": tokens.priorityUrgent,
    "--priority-high": tokens.priorityHigh,
    "--priority-normal": tokens.priorityNormal,
    "--priority-low": tokens.priorityLow,
    "--priority-suggestion": tokens.prioritySuggestion,
    "--mono-bg": tokens.monaco.bg,
    "--mono-fg": tokens.monaco.fg,
    "--mono-gutter": tokens.monaco.gutter,
    "--mono-lineHighlight": tokens.monaco.lineHighlight,
    "--mono-selection": tokens.monaco.selection,
    "--mono-cursor": tokens.monaco.cursor,
    "--collab-cursor-self": tokens.accent,
  };
  for (const [k, v] of Object.entries(map)) {
    root.style.setProperty(k, v);
  }
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeId = useThemeStore((s) => s.themeId);
  const respectsSystemPreference = useThemeStore((s) => s.respectsSystemPreference);
  const setTheme = useThemeStore((s) => s.setTheme);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);
  const appliedThemeRef = useRef<string>("");

  // Apply tokens whenever theme changes
  useEffect(() => {
    const theme = getActiveTheme();
    applyTokensToCSS(theme.tokens);

    // Set data-theme on <html> — used by [data-theme="..."] selectors in globals.css
    document.documentElement.setAttribute("data-theme", theme.id);

    // Toggle .dark class for shadcn primitives that rely on it
    if (theme.mode === "dark" || theme.mode === "high-contrast") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // color-scheme — affects native form controls, scrollbars, etc.
    document.documentElement.style.colorScheme =
      theme.mode === "light" ? "light" : "dark";

    // theme-color meta — for mobile browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme.tokens.surfaceApp);
    }

    appliedThemeRef.current = theme.id;
  }, [themeId, getActiveTheme]);

  // Respect prefers-color-scheme on first visit (until user picks explicitly)
  useEffect(() => {
    if (!respectsSystemPreference) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const newId = e.matches ? "midnight" : "daybreak";
      setTheme(newId);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [respectsSystemPreference, setTheme]);

  return <>{children}</>;
}

/**
 * Inline script — runs before paint to set the initial theme.
 * Prevents the flash-of-wrong-theme that would otherwise occur while
 * React hydrates and zustand rehydrates from localStorage.
 *
 * Drop this into <head> via layout.tsx.
 */
export const themeInitScript = `
(function() {
  try {
    var stored = JSON.parse(localStorage.getItem('stellarforge:theme') || '{}');
    var state = stored.state || {};
    var themeId = state.themeId;
    // Default to midnight — user can switch in Settings
    if (!themeId) {
      themeId = 'midnight';
    }
    document.documentElement.setAttribute('data-theme', themeId);
    var lightThemes = ['daybreak','frost','parchment'];
    if (lightThemes.indexOf(themeId) >= 0) {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'midnight');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;
