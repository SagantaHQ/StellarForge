import type * as Monaco from "monaco-editor";
import type { ThemeDefinition } from "./types";

/**
 * Build a Monaco editor theme definition from our ThemeDefinition.
 * Token colors are mapped from our syntax palette.
 *
 * This is the bridge between our token-based theme engine and Monaco's
 * own theme system — app chrome, editor, and terminal all stay in sync.
 */
export function buildMonacoTheme(theme: ThemeDefinition): Monaco.editor.IStandaloneThemeData {
  const s = theme.tokens.monaco.syntax;
  return {
    base: theme.mode === "light" ? "vs" : "vs-dark",
    inherit: false,
    rules: [
      { token: "", foreground: theme.tokens.monaco.fg },
      { token: "comment", foreground: s.comment, fontStyle: "italic" },
      { token: "string", foreground: s.string },
      { token: "string.escape", foreground: s.string },
      { token: "number", foreground: s.number },
      { token: "keyword", foreground: s.keyword },
      { token: "keyword.control", foreground: s.keyword },
      { token: "keyword.operator", foreground: s.operator },
      { token: "function", foreground: s.function },
      { token: "type", foreground: s.type },
      { token: "type.identifier", foreground: s.type },
      { token: "macro", foreground: s.macro },
      { token: "attribute", foreground: s.attribute },
      { token: "variable", foreground: s.variable },
      { token: "variable.predefined", foreground: s.constant },
      { token: "constant", foreground: s.constant },
      { token: "delimiter", foreground: s.punctuation },
      { token: "delimiter.bracket", foreground: s.punctuation },
      { token: "tag", foreground: s.tag },
      { token: "attribute.name", foreground: s.attributeName },
      { token: "attribute.value", foreground: s.attributeValue },
      { token: "property", foreground: s.property },
    ],
    colors: {
      "editor.background": theme.tokens.monaco.bg,
      "editor.foreground": theme.tokens.monaco.fg,
      "editorLineNumber.foreground": theme.tokens.monaco.gutter,
      "editorLineNumber.activeForeground": theme.tokens.monaco.gutterActive,
      "editor.lineHighlightBackground": theme.tokens.monaco.lineHighlight,
      "editor.lineHighlightBorder": theme.tokens.monaco.lineHighlight,
      "editor.selectionBackground": theme.tokens.monaco.selection,
      "editor.inactiveSelectionBackground": theme.tokens.monaco.selection,
      // §Fix — selectionHighlight (matching occurrences) should be SUBTLER
      // than the main selection. Previously both used the same color, which
      // made every occurrence of a selected word flash in the full selection
      // color — too intense. Now we use a much lower opacity version.
      "editor.selectionHighlightBackground": theme.tokens.monaco.selection.replace(/[\d.]+\)$/, "0.12)"),
      "editorCursor.foreground": theme.tokens.monaco.cursor,
      "editorWhitespace.foreground": theme.tokens.monaco.whitespace,
      "editorIndentGuide.background": theme.tokens.monaco.whitespace,
      "editorIndentGuide.activeBackground": theme.tokens.monaco.gutterActive,
      "editorGutter.background": theme.tokens.monaco.bg,
      "editorWidget.background": theme.tokens.surfacePanel,
      "editorWidget.foreground": theme.tokens.textPrimary,
      "editorWidget.border": theme.tokens.borderSubtle,
      "editorSuggestWidget.background": theme.tokens.surfacePanel,
      "editorSuggestWidget.foreground": theme.tokens.textPrimary,
      "editorSuggestWidget.selectedBackground": theme.tokens.surfaceHover,
      "editorSuggestWidget.highlightForeground": theme.tokens.accent,
      "editorHoverWidget.background": theme.tokens.surfacePanel,
      "editorHoverWidget.border": theme.tokens.borderSubtle,
      "editorBracketMatch.background": theme.tokens.accentSubtle ?? theme.tokens.accent + "20",
      "editorBracketMatch.border": theme.tokens.accent,
      "editorOverviewRuler.border": theme.tokens.borderSubtle,
      "scrollbarSlider.background": theme.tokens.borderStrong + "80",
      "scrollbarSlider.hoverBackground": theme.tokens.borderStrong,
      "scrollbarSlider.activeBackground": theme.tokens.textMuted,
      "minimap.background": theme.tokens.surfaceSunken,
      "editorError.foreground": theme.tokens.statusError,
      "editorWarning.foreground": theme.tokens.statusWarning,
      "editorInfo.foreground": theme.tokens.statusInfo,
      "editorGutter.commentRangeForeground": theme.tokens.textMuted,
      "editorGutter.commentGlyphForeground": theme.tokens.textSecondary,
      // Activity bar / sidebar colors (Monacopeek widgets)
      "editorInlayHint.background": theme.tokens.surfaceRaised,
      "editorInlayHint.foreground": theme.tokens.textSecondary,
      "editorInlayHint.typeBackground": theme.tokens.surfaceRaised,
      "editorInlayHint.typeForeground": theme.tokens.textSecondary,
    },
  };
}

/**
 * Build an xterm.js ITheme object from our ThemeDefinition.
 */
export function buildXtermTheme(theme: ThemeDefinition) {
  const t = theme.tokens.terminal;
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.background,
    selection: t.selection,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  } as const;
}
