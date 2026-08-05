import type { ThemeDefinition } from "./types";
import { midnight } from "./builtins/midnight";
import { daybreak } from "./builtins/daybreak";
import { slate } from "./builtins/slate";
import { frost } from "./builtins/frost";
import { parchment } from "./builtins/parchment";
import { ember } from "./builtins/ember";
import { forest } from "./builtins/forest";
import { harbor } from "./builtins/harbor";
import { mono } from "./builtins/mono";
import { contrast } from "./builtins/contrast";

/**
 * Built-in themes registry. §4.1: ship with 10 themes pre-installed.
 * All obey the design rules — no gradients, no neons, muted tones.
 */
export const BUILT_IN_THEMES: ThemeDefinition[] = [
  midnight,
  daybreak,
  slate,
  frost,
  parchment,
  ember,
  forest,
  harbor,
  mono,
  contrast,
];

export const DEFAULT_DARK_THEME_ID = "midnight";
export const DEFAULT_LIGHT_THEME_ID = "daybreak";

export function getThemeById(id: string): ThemeDefinition | undefined {
  return BUILT_IN_THEMES.find((t) => t.id === id);
}

export function getDefaultThemeForMode(mode: "dark" | "light" | "high-contrast"): string {
  if (mode === "light") return DEFAULT_LIGHT_THEME_ID;
  return DEFAULT_DARK_THEME_ID;
}
