/**
 * Theme token type — every theme (built-in or user-installed) conforms to this shape.
 * Tokens map onto CSS variables consumed by app chrome, plus Monaco & xterm palettes.
 *
 * §4 rules: NO gradients, NO neons. Solid muted fills only.
 */
export type ThemeMode = "dark" | "light" | "high-contrast";

export interface ThemeTokens {
  /* surfaces (flat solid fills — depth via 1px borders + subtle elevation shifts) */
  surfaceApp: string;
  surfacePanel: string;
  surfaceRaised: string;
  surfaceSunken: string;
  surfaceHover: string;
  surfaceActive: string;

  /* borders — hairline, low-contrast */
  borderSubtle: string;
  borderStrong: string;
  borderInput: string;

  /* text */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;

  /* accent — single distinctive but muted hue, NOT indigo/purple */
  accent: string;
  accentHover: string;
  accentActive: string;
  accentContrast: string;

  /* semantic — desaturated to sit quietly */
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
  statusInfo: string;

  /* comment priority palette — muted, not neon */
  priorityUrgent: string;
  priorityHigh: string;
  priorityNormal: string;
  priorityLow: string;
  prioritySuggestion: string;

  /* Monaco editor */
  monaco: {
    bg: string;
    fg: string;
    gutter: string;
    gutterActive: string;
    lineHighlight: string;
    selection: string;
    cursor: string;
    whitespace: string;
    /** Syntax token colors — keyed by Monaco token type */
    syntax: {
      comment: string;
      string: string;
      number: string;
      keyword: string;
      function: string;
      type: string;
      macro: string;
      attribute: string;
      variable: string;
      constant: string;
      operator: string;
      punctuation: string;
      tag: string;
      attributeName: string;
      attributeValue: string;
      property: string;
    };
  };

  /** xterm.js ANSI palette (16 colors + bg/fg + cursor + selection) */
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

export interface ThemeDefinition {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Short marketing description shown on theme card */
  description: string;
  /** True if shipped with the app; false for user-installed */
  builtIn: boolean;
  /** Whether this is the default for its mode */
  defaultForMode?: boolean;
  tokens: ThemeTokens;
}

/**
 * Convert a hex color (#RGB / #RRGGBB) to "r,g,b" for rgba() composition.
 */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
