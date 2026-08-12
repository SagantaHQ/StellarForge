/**
 * Auto-import logic for Rust / Soroban completion.
 *
 * Given the source text of a `.rs` file and a symbol (with its crate path),
 * determine:
 *   1. Whether the symbol is already imported via an existing `use` statement.
 *   2. If not, build a Monaco `TextEdit` that adds the import.
 *
 * Monaco applies `additionalTextEdits` atomically with the completion's main
 * insert — this is exactly how VS Code does auto-import.
 *
 * Crate name handling: Cargo.toml uses dashes (e.g. `stellar-strkey`), Rust
 * `use` statements use underscores (e.g. `use stellar_strkey::Strkey`). We
 * normalize to the underscore form.
 */

export interface MonacoTextEdit {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
}

export interface AutoImportInput {
  /** Crate name (either `soroban_sdk` or `stellar-strkey` form works). */
  crate: string;
  /** Symbol name to import, e.g. `Address`, `BytesN`, `Strkey`. */
  symbol: string;
  /** Symbol kind — only type-like kinds are auto-imported. */
  kind: string;
}

export interface AutoImportResult {
  /** The text edit that adds the import (inserts/extends a `use` statement). */
  edit: MonacoTextEdit;
  /** Human-readable description for logging / debugging. */
  description: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Crate name in Rust `use` form (dashes → underscores). */
function crateUseName(crate: string): string {
  return crate.replace(/-/g, "_");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns true if this symbol kind is type-like (worth auto-importing). */
export function isAutoImportableKind(kind: string): boolean {
  return (
    kind === "struct" ||
    kind === "enum" ||
    kind === "trait" ||
    kind === "type_alias" ||
    kind === "typeAlias" ||
    kind === "module"
  );
}

/**
 * Check whether a symbol is already imported from the given crate in the
 * source text.
 *
 * Handles all three forms:
 *   - `use crate::Symbol;`                     (single)
 *   - `use crate::{A, B, Symbol};`             (group, single line)
 *   - `use crate::{\n  A,\n  Symbol,\n};`      (group, multi-line)
 *   - `use crate::*;`                          (glob — covers everything)
 *   - `use crate::Symbol as Alias;`            (aliased — still imported)
 */
export function isSymbolImported(
  source: string,
  crate: string,
  symbol: string
): boolean {
  const crateName = crateUseName(crate);
  const symPat = escapeRegex(symbol);

  // Glob: `use crate::*;`
  const globRe = new RegExp(
    `^\\s*use\\s+${escapeRegex(crateName)}::\\*\\s*;`,
    "m"
  );
  if (globRe.test(source)) return true;

  // Single: `use crate::Symbol;` or `use crate::Symbol as Alias;`
  const singleRe = new RegExp(
    `^\\s*use\\s+${escapeRegex(crateName)}::\\s*${symPat}\\s*(?:as\\s+\\w+)?\\s*;`,
    "m"
  );
  if (singleRe.test(source)) return true;

  // Group: `use crate::{ ... }` — find each group, then check if symbol is
  // listed inside.
  const groupRe = new RegExp(
    `^\\s*use\\s+${escapeRegex(crateName)}::\\s*\\{([\\s\\S]*?)\\}\\s*;`,
    "gm"
  );
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(source)) !== null) {
    const inner = m[1];
    // Split by comma, strip `as Alias` part, trim whitespace.
    const items = inner
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    if (items.includes(symbol) || items.includes("*")) return true;
  }

  return false;
}

/**
 * Check whether ANY symbol with the given name is already imported from
 * any crate. Used to avoid shadowing conflicts.
 */
export function isSymbolNameImportedFromAnyCrate(
  source: string,
  symbol: string
): boolean {
  const symPat = escapeRegex(symbol);

  // `use any::path::Symbol;`
  const singleRe = new RegExp(
    `^\\s*use\\s+[a-zA-Z0-9_:]+::\\s*${symPat}\\s*(?:as\\s+\\w+)?\\s*;`,
    "m"
  );
  if (singleRe.test(source)) return true;

  // `use any::path::{..., Symbol, ...}`
  const groupRe = new RegExp(
    `^\\s*use\\s+[a-zA-Z0-9_:]+::\\s*\\{([\\s\\S]*?)\\}\\s*;`,
    "gm"
  );
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(source)) !== null) {
    const items = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    if (items.includes(symbol)) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Edit builder                                                       */
/* ------------------------------------------------------------------ */

interface LineRange {
  /** 1-indexed line number. */
  lineNumber: number;
  /** Full text of the line (no newline). */
  text: string;
  /** Column where `use` keyword starts (1-indexed). */
  startColumn: number;
}

function findUseLines(source: string): LineRange[] {
  const lines = source.split("\n");
  const out: LineRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const m = text.match(/^(\s*)use\s+/);
    if (m) {
      out.push({
        lineNumber: i + 1,
        text,
        startColumn: (m[1]?.length ?? 0) + 1,
      });
    }
  }
  return out;
}

/**
 * Build a TextEdit that adds `symbol` to an existing `use crate::{...}` group,
 * OR converts `use crate::Existing;` into `use crate::{Existing, symbol};`.
 *
 * Returns null if no suitable existing `use crate::...` statement is found.
 */
function extendExistingUse(
  source: string,
  crate: string,
  symbol: string
): { edit: MonacoTextEdit; description: string } | null {
  const crateName = crateUseName(crate);
  const lines = source.split("\n");

  // Case 1: single-form `use crate::Existing;`
  const singleRe = new RegExp(
    `^(\\s*use\\s+${escapeRegex(crateName)}::)(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*)(;\\s*)$`
  );
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(singleRe);
    if (m) {
      const existing = m[2].trim();
      // Convert to group form
      const newLine = `${m[1]}{${existing}, ${symbol}}${m[3]}`;
      return {
        edit: {
          range: {
            startLineNumber: i + 1,
            startColumn: 1,
            endLineNumber: i + 1,
            endColumn: lines[i].length + 1,
          },
          text: newLine,
        },
        description: `extended single use at line ${i + 1} → {${existing}, ${symbol}}`,
      };
    }
  }

  // Case 2: group-form `use crate::{ ... }` (single OR multi-line)
  // We scan line-by-line, detecting the `use crate::{` opener and finding
  // the matching `}` (handling nesting just in case).
  for (let i = 0; i < lines.length; i++) {
    const openMatch = lines[i].match(
      new RegExp(`^(\\s*use\\s+${escapeRegex(crateName)}::\\s*)\\{`)
    );
    if (!openMatch) continue;

    // Find matching close brace — track depth.
    let depth = 1;
    let closeLineIdx = -1;
    let closeCol = -1;
    {
      let lineIdx = i;
      // openMatch[1] is everything up to and including the `{` prefix — wait,
      // the regex captures up to (but NOT including) `{`. So `{` is at index
      // openMatch[1].length. col starts at the char AFTER `{`.
      let col = openMatch[1].length + 1;
      let done = false;
      while (lineIdx < lines.length && !done) {
        const line = lines[lineIdx];
        while (col < line.length) {
          const ch = line[col];
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              closeLineIdx = lineIdx;
              closeCol = col; // 0-indexed position of `}`
              done = true;
              break;
            }
          }
          col++;
        }
        if (!done) {
          lineIdx++;
          col = 0;
        }
      }
    }

    if (closeLineIdx === -1) continue; // malformed — skip

    // Decide where to insert. We want to insert `, symbol` right before `}`.
    // If the content right before `}` is empty or just `{`, no leading comma;
    // else add `, `.
    let lastNonWsBeforeClose = "{";
    if (closeLineIdx === i) {
      // single-line group: scan from openMatch[1].length+1 to closeCol-1
      const inner = lines[closeLineIdx].slice(
        openMatch[1].length + 1,
        closeCol
      );
      const trimmed = inner.trimEnd();
      if (trimmed.length > 0 && trimmed !== "{") {
        lastNonWsBeforeClose = trimmed[trimmed.length - 1];
      }
    } else {
      // multi-line group: scan the close line backwards from closeCol
      let c = closeCol - 1;
      let l = closeLineIdx;
      while (l >= i) {
        const line = lines[l];
        while (c >= 0) {
          const ch = line[c];
          if (!/\s/.test(ch)) {
            lastNonWsBeforeClose = ch;
            break;
          }
          c--;
        }
        if (lastNonWsBeforeClose !== "{") break;
        l--;
        if (l >= 0) c = lines[l].length - 1;
      }
    }

    const needsComma =
      lastNonWsBeforeClose !== "," && lastNonWsBeforeClose !== "{";

    // Insert immediately before the `}`.
    const insertText = (needsComma ? ", " : " ") + symbol;

    return {
      edit: {
        range: {
          startLineNumber: closeLineIdx + 1,
          startColumn: closeCol + 1, // 1-indexed position of `}`
          endLineNumber: closeLineIdx + 1,
          endColumn: closeCol + 1,
        },
        text: insertText,
      },
      description: `extended group use at line ${i + 1} (close brace at line ${
        closeLineIdx + 1
      }) with ${symbol}`,
    };
  }

  return null;
}

/**
 * Find the right place to insert a new `use crate::Symbol;` line.
 *
 * Strategy:
 *   - If the file already has `use` statements, insert AFTER the last one.
 *   - Otherwise, insert at line 1, column 1 (top of file).
 *
 * Returns a TextEdit that inserts the new line.
 */
function insertNewUse(
  source: string,
  crate: string,
  symbol: string
): { edit: MonacoTextEdit; description: string } {
  const crateName = crateUseName(crate);
  const useLines = findUseLines(source);
  const newLine = `use ${crateName}::${symbol};`;

  if (useLines.length === 0) {
    // No existing use statements — insert at top of file.
    return {
      edit: {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        text: newLine + "\n",
      },
      description: `inserted new use at top of file: ${newLine}`,
    };
  }

  // Insert after the last `use` statement. We need to find where that
  // statement ends (could span multiple lines for group imports).
  const lastUse = useLines[useLines.length - 1];
  const lines = source.split("\n");

  // Walk forward from lastUse.lineNumber to find the next `;` — that's the
  // end of the use statement.
  let endLine = lastUse.lineNumber - 1; // 0-indexed
  for (let i = lastUse.lineNumber - 1; i < lines.length; i++) {
    const line = lines[i];
    const semiIdx = line.indexOf(";");
    if (semiIdx !== -1) {
      endLine = i;
      break;
    }
  }

  // Insert at the start of the line AFTER endLine.
  const insertLine = endLine + 2; // 1-indexed
  return {
    edit: {
      range: {
        startLineNumber: insertLine,
        startColumn: 1,
        endLineNumber: insertLine,
        endColumn: 1,
      },
      text: newLine + "\n",
    },
    description: `inserted new use after line ${endLine + 1}: ${newLine}`,
  };
}

/**
 * Main entry point — given file source + symbol info, return the TextEdit
 * that adds the import (or null if already imported / not auto-importable).
 */
export function buildAutoImportEdit(
  source: string,
  input: AutoImportInput
): AutoImportResult | null {
  const { crate, symbol, kind } = input;

  // Only auto-import type-like symbols.
  if (!isAutoImportableKind(kind)) return null;

  // Already imported from this crate? No-op.
  if (isSymbolImported(source, crate, symbol)) return null;

  // Same name already imported from ANY crate? Skip — would shadow/conflict.
  // (User can manually resolve if they really want both.)
  if (isSymbolNameImportedFromAnyCrate(source, symbol)) return null;

  // Try to extend an existing `use crate::...` first.
  const extend = extendExistingUse(source, crate, symbol);
  if (extend) return { edit: extend.edit, description: extend.description };

  // Otherwise, insert a new `use crate::Symbol;` line.
  const fresh = insertNewUse(source, crate, symbol);
  return fresh;
}
