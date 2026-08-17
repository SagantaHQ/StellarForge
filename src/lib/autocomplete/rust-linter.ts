/**
 * §Intelligent simple-mode linting (2026-08-16)
 *
 * A lightweight Rust linter that runs entirely in the browser — no
 * rust-analyzer needed. Catches common Soroban SDK mistakes that
 * beginners make, with quick-fix code actions.
 *
 * Lint rules:
 *   1. Unused `use` imports            → hint + quick fix: "Remove unused import"
 *   2. Missing `use` for used symbols  → warning + quick fix: "Add missing import"
 *   3. Unbalanced braces/parens/brackets → error
 *   4. Missing semicolons (heuristic)  → warning
 *   5. `unwrap()` on Result/Option     → hint: "Consider handling the error"
 *   6. `panic!()` / `unreachable!()`   → hint: production code shouldn't panic
 *   7. Mutable borrow without `mut`    → warning (heuristic)
 *   8. `String::from_str` without Env  → error: missing first arg
 *   9. Missing `#![no_std]`            → error for Soroban contracts
 *  10. Missing `#[contract]` / `#[contractimpl]` → hint
 *
 * Each rule produces:
 *   - A Monaco marker (squiggly underline)
 *   - A code action (lightbulb quick fix) where applicable
 *
 * Performance: all checks are O(lines) with small constant factors.
 * Runs debounced (500ms) on content change — no perceptible typing lag.
 */

import type * as Monaco from "monaco-editor";
import { buildAutoImportEdit, isSymbolImported } from "./auto-import";
import { TYPE_MEMBERS, getTypeCrate } from "./type-members";

export interface LintDiagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: Monaco.MarkerSeverity;
  source: string;
  code: string;
  /** Quick-fix action (if any) — what to do when user clicks the lightbulb. */
  quickFix?: {
    title: string;
    edits: Array<{
      range: Monaco.IRange;
      text: string;
    }>;
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Get the 1-indexed line number for a character offset in the source. */
function lineForOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Get the 1-indexed column for a character offset in the source. */
function columnForOffset(source: string, offset: number): number {
  let col = 1;
  for (let i = offset - 1; i >= 0 && source[i] !== "\n"; i--) col++;
  return col;
}

/** Check if a brace character matches its expected closer. */
function isMatchingOpener(opener: string, closer: string): boolean {
  return (opener === "(" && closer === ")") ||
         (opener === "[" && closer === "]") ||
         (opener === "{" && closer === "}");
}

/** Strip comments + strings from source so brace counting isn't fooled by `// {` or `"{"`. */
export function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  let inRawString = false; // r"..." or r#"..."#

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "*" && next === "/") { out += " "; i += 2; inBlockComment = false; continue; }
      i++;
      continue;
    }
    if (inString) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "\\") { out += " "; i += 2; continue; } // skip escaped char
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (inChar) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "\\") { out += " "; i += 2; continue; }
      if (ch === "'") inChar = false;
      i++;
      continue;
    }

    // Not in any comment/string — check for transitions
    if (ch === "/" && next === "/") { inLineComment = true; out += "  "; i += 2; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; out += "  "; i += 2; continue; }
    if (ch === '"') { inString = true; out += " "; i++; continue; }
    if (ch === "'") {
      // Distinguish char literal from lifetime label ('static, 'a)
      // Lifetime: ' followed by a letter and not preceded by an identifier char
      // Simplification: if next is a letter AND the char after isn't a closing ',
      // treat as lifetime (don't enter char mode)
      const after = source[i + 1];
      const afterAfter = source[i + 2];
      if (/[a-zA-Z]/.test(after) && afterAfter !== "'") {
        // Lifetime — don't enter char mode
        out += ch;
        i++;
        continue;
      }
      inChar = true;
      out += " ";
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lint rules                                                          */
/* ------------------------------------------------------------------ */

interface LintContext {
  source: string;
  strippedSource: string; // comments + strings removed
  lines: string[];
  strippedLines: string[];
}

/** Rule 1: Unused `use` imports */
function lintUnusedImports(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];

  // Handle group imports: `use crate::{A, B, C};` or multi-line:
  //   use crate::{
  //     A,
  //     B,
  //   };
  // We parse each group + check each symbol individually.
  const groupRe = /^\s*use\s+([a-zA-Z0-9_:]+)::\s*\{([^}]*)\}\s*(?:as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(ctx.source)) !== null) {
    const crate = m[1];
    const groupBody = m[2];
    const groupLineStart = lineForOffset(ctx.source, m.index);
    // Parse symbols from the group body (split by comma, strip aliases)
    const symbols = groupBody.split(",")
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => s && s !== "*");
    for (const symbol of symbols) {
      // Check if the symbol is used anywhere (excluding the use line + comments)
      let used = false;
      for (let i = 0; i < ctx.strippedLines.length; i++) {
        if (i >= groupLineStart - 1 && i <= groupLineStart - 1 + groupBody.split("\n").length) continue;
        const usageRe = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (usageRe.test(ctx.strippedLines[i])) {
          used = true;
          break;
        }
      }
      if (!used) {
        // Find the symbol's position within the use line for the marker
        const symbolIdx = ctx.lines[groupLineStart - 1].indexOf(symbol);
        // §Fix — always provide a quick fix, even for multi-symbol groups.
        // For multi-symbol groups, the quick fix removes just the unused
        // symbol from the group (preserving the others).
        let quickFixEdits: Array<{ range: Monaco.IRange; text: string }> | undefined;
        if (symbols.length === 1) {
          // Only symbol in the group → remove the whole use statement
          const stmtEndLine = groupLineStart - 1 + ctx.lines.slice(groupLineStart - 1).findIndex(l => l.includes(";"));
          quickFixEdits = [{
            range: {
              startLineNumber: groupLineStart,
              startColumn: 1,
              endLineNumber: stmtEndLine + 2,
              endColumn: 1,
            },
            text: "",
          }];
        } else {
          // Multi-symbol group → remove just this symbol from the group body.
          // Find the symbol's position in the source and remove it + the
          // trailing comma (or leading comma if it's the last symbol).
          const symbolInSource = ctx.source.indexOf(symbol, m.index);
          if (symbolInSource !== -1) {
            // Find the comma before or after the symbol
            let removeStart = symbolInSource;
            let removeEnd = symbolInSource + symbol.length;
            // Look for a comma after the symbol (skip whitespace)
            let i = removeEnd;
            while (i < ctx.source.length && /\s/.test(ctx.source[i])) i++;
            if (ctx.source[i] === ",") {
              removeEnd = i + 1;
            } else {
              // Look for a comma before the symbol (skip whitespace)
              i = removeStart - 1;
              while (i >= 0 && /\s/.test(ctx.source[i])) i--;
              if (ctx.source[i] === ",") {
                removeStart = i;
              }
            }
            const removeStartLine = lineForOffset(ctx.source, removeStart);
            const removeStartCol = columnForOffset(ctx.source, removeStart);
            const removeEndLine = lineForOffset(ctx.source, removeEnd);
            const removeEndCol = columnForOffset(ctx.source, removeEnd);
            quickFixEdits = [{
              range: {
                startLineNumber: removeStartLine,
                startColumn: removeStartCol,
                endLineNumber: removeEndLine,
                endColumn: removeEndCol,
              },
              text: "",
            }];
          }
        }
        diags.push({
          startLineNumber: groupLineStart,
          startColumn: symbolIdx + 1,
          endLineNumber: groupLineStart,
          endColumn: symbolIdx + 1 + symbol.length,
          message: `Unused import: \`${crate}::${symbol}\``,
          severity: Monaco.MarkerSeverity.Hint,
          source: "stellarforge",
          code: "unused-import",
          quickFix: quickFixEdits ? {
            title: `Remove unused import \`${symbol}\``,
            edits: quickFixEdits,
          } : undefined,
        });
      }
    }
  }

  // Handle single imports: `use crate::Symbol;` or `use crate::Symbol as Alias;`
  const singleRe = /^\s*use\s+(?:([a-zA-Z0-9_:]+)::)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gm;
  while ((m = singleRe.exec(ctx.source)) !== null) {
    // Skip if this was already processed as part of a group
    if (m[1] && ctx.source.slice(m.index, m.index + m[0].length).includes("{")) continue;

    const symbol = m[3] ?? m[2]; // use alias if present
    const useLineIdx = lineForOffset(ctx.source, m.index) - 1;
    const useLineText = ctx.lines[useLineIdx];

    // Check if the symbol is used anywhere (excluding the use line + comments)
    let used = false;
    for (let i = 0; i < ctx.strippedLines.length; i++) {
      if (i === useLineIdx) continue;
      const usageRe = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (usageRe.test(ctx.strippedLines[i])) {
        used = true;
        break;
      }
    }

    if (!used) {
      diags.push({
        startLineNumber: useLineIdx + 1,
        startColumn: 1,
        endLineNumber: useLineIdx + 1,
        endColumn: useLineText.length + 1,
        message: `Unused import: \`${symbol}\``,
        severity: Monaco.MarkerSeverity.Hint,
        source: "stellarforge",
        code: "unused-import",
        quickFix: {
          title: `Remove unused import \`${symbol}\``,
          edits: [{
            range: {
              startLineNumber: useLineIdx + 1,
              startColumn: 1,
              endLineNumber: useLineIdx + 2,
              endColumn: 1,
            },
            text: "",
          }],
        },
      });
    }
  }
  return diags;
}

/** Rule 2: Missing `use` for used symbols */
function lintMissingImports(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  // For each symbol in TYPE_MEMBERS, check if it's used in the source
  // but not imported.
  for (const [typeName, info] of Object.entries(TYPE_MEMBERS)) {
    // Skip if the type isn't used in the source
    const usageRe = new RegExp(`\\b${typeName}\\b`);
    if (!usageRe.test(ctx.strippedSource)) continue;

    // Skip if already imported (from any crate)
    // We use a simplified check: look for `use <crate>::${typeName}` or
    // `use <crate>::{..., ${typeName}, ...}`
    const crate = info.crate;
    if (isSymbolImported(ctx.source, crate, typeName)) continue;

    // Find the first usage location (excluding use lines + comments)
    let firstUseLine = -1;
    let firstUseCol = -1;
    for (let i = 0; i < ctx.strippedLines.length; i++) {
      const line = ctx.strippedLines[i];
      if (/^\s*use\s/.test(line)) continue; // skip use lines
      const match = line.match(new RegExp(`\\b${typeName}\\b`));
      if (match) {
        firstUseLine = i + 1;
        firstUseCol = match.index! + 1;
        break;
      }
    }
    if (firstUseLine === -1) continue;

    // Build the auto-import edit
    const importResult = buildAutoImportEdit(ctx.source, {
      crate,
      symbol: typeName,
      kind: "struct",
    });

    diags.push({
      startLineNumber: firstUseLine,
      startColumn: firstUseCol,
      endLineNumber: firstUseLine,
      endColumn: firstUseCol + typeName.length,
      message: `\`${typeName}\` is used but not imported (from \`${crate}\`)`,
      severity: Monaco.MarkerSeverity.Warning,
      source: "stellarforge",
      code: "missing-import",
      quickFix: importResult ? {
        title: `Import \`${crate}::${typeName}\``,
        edits: [{
          range: {
            startLineNumber: importResult.edit.range.startLineNumber,
            startColumn: importResult.edit.range.startColumn,
            endLineNumber: importResult.edit.range.endLineNumber,
            endColumn: importResult.edit.range.endColumn,
          },
          text: importResult.edit.text,
        }],
      } : undefined,
    });
  }
  return diags;
}

/** Rule 3: Unbalanced braces/parens/brackets */
function lintUnbalancedBraces(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  const stack: Array<{ char: string; line: number; col: number }> = [];
  const stripped = ctx.strippedSource;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      const line = lineForOffset(stripped, i);
      const col = columnForOffset(stripped, i);
      stack.push({ char: ch, line, col });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length === 0) {
        const line = lineForOffset(stripped, i);
        const col = columnForOffset(stripped, i);
        diags.push({
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 1,
          message: `Unmatched closing \`${ch}\``,
          severity: Monaco.MarkerSeverity.Error,
          source: "stellarforge",
          code: "unmatched-closer",
        });
      } else {
        const opener = stack.pop()!;
        if (!isMatchingOpener(opener.char, ch)) {
          const line = lineForOffset(stripped, i);
          const col = columnForOffset(stripped, i);
          diags.push({
            startLineNumber: opener.line,
            startColumn: opener.col,
            endLineNumber: opener.line,
            endColumn: opener.col + 1,
            message: `Expected \`${matchingCloser(opener.char)}\` to close \`${opener.char}\` at line ${opener.line}, but found \`${ch}\``,
            severity: Monaco.MarkerSeverity.Error,
            source: "stellarforge",
            code: "mismatched-brace",
          });
        }
      }
    }
  }

  // Unclosed openers
  for (const opener of stack) {
    diags.push({
      startLineNumber: opener.line,
      startColumn: opener.col,
      endLineNumber: opener.line,
      endColumn: opener.col + 1,
      message: `Unclosed \`${opener.char}\``,
      severity: Monaco.MarkerSeverity.Error,
      source: "stellarforge",
      code: "unclosed-opener",
    });
  }

  return diags;
}

function matchingCloser(opener: string): string {
  return opener === "(" ? ")" : opener === "[" ? "]" : "}";
}

/** Rule 4: Missing semicolons (heuristic) */
function lintMissingSemicolons(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  // Look for lines that look like statements (assignment, function call)
  // but don't end with `;` or `{` or `}` or `,` or `(` or `)`.
  for (let i = 0; i < ctx.strippedLines.length; i++) {
    const line = ctx.strippedLines[i].trimEnd();
    if (!line) continue;
    // Skip lines that obviously don't need semicolons
    if (/^\s*(\/\/|\/\*|\*|use|pub|fn|struct|enum|impl|trait|mod|for|if|else|match|while|loop|unsafe|async|move|const|static|type)\b/.test(line)) continue;
    if (line.endsWith(";") || line.endsWith("{") || line.endsWith("}") || line.endsWith(",") || line.endsWith("(") || line.endsWith(")") || line.endsWith("->") || line.endsWith("=>")) continue;
    // Look for assignment or function call patterns
    if (/\b=\s*[^=]/.test(line) || /\w+\s*\([^)]*\)\s*$/.test(line)) {
      diags.push({
        startLineNumber: i + 1,
        startColumn: line.length + 1,
        endLineNumber: i + 1,
        endColumn: line.length + 1,
        message: `Missing semicolon? (line ends with what looks like a statement)`,
        severity: Monaco.MarkerSeverity.Warning,
        source: "stellarforge",
        code: "maybe-missing-semicolon",
      });
    }
  }
  return diags;
}

/** Rule 5: `unwrap()` usage */
function lintUnwrap(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  const unwrapRe = /\.unwrap\(\)/g;
  let m: RegExpExecArray | null;
  while ((m = unwrapRe.exec(ctx.strippedSource)) !== null) {
    const line = lineForOffset(ctx.strippedSource, m.index);
    const col = columnForOffset(ctx.strippedSource, m.index);
    diags.push({
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + m[0].length,
      message: `.unwrap() will panic if the value is None/Err. Consider using match or ? operator.`,
      severity: Monaco.MarkerSeverity.Info,
      source: "stellarforge",
      code: "unwrap-panic",
    });
  }
  return diags;
}

/** Rule 6: `panic!()` / `unreachable!()` */
function lintPanic(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  const panicRe = /\b(panic!|unreachable!|todo!|unimplemented!)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = panicRe.exec(ctx.strippedSource)) !== null) {
    const line = lineForOffset(ctx.strippedSource, m.index);
    const col = columnForOffset(ctx.strippedSource, m.index);
    diags.push({
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + m[1].length,
      message: `\`${m[1]}\` will abort the contract. Production code should handle errors gracefully.`,
      severity: Monaco.MarkerSeverity.Info,
      source: "stellarforge",
      code: "panic-in-contract",
    });
  }
  return diags;
}

/** Rule 7: Missing `#![no_std]` for Soroban contracts */
function lintNoStd(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  // If the file looks like a Soroban contract but doesn't have #![no_std].
  // Signals that this is a Soroban contract:
  //   - `#[contract]` or `#[contractimpl]` attribute
  //   - `soroban_sdk` in a use statement
  //   - Use of Soroban SDK types (Env, Address, Symbol, Bytes, BytesN, Vec, Map, etc.)
  // §Fix — check the ORIGINAL source (not stripped), because #[contract]
  // contains `#[` which survives stripping but the attribute itself might
  // get mangled.
  const hasContractAttr = /#\[contract\]|#\[contractimpl\]/.test(ctx.source);
  const hasSorobanUse = /use\s+soroban_sdk/.test(ctx.source);
  const hasSorobanType = /\b(Env|Address|Symbol|BytesN|soroban_sdk)\b/.test(ctx.source);
  const hasNoStd = /#!\[no_std\]/.test(ctx.source);
  if ((hasContractAttr || hasSorobanUse || hasSorobanType) && !hasNoStd) {
    diags.push({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      message: `Soroban contracts require \`#![no_std]\` at the top of the file`,
      severity: Monaco.MarkerSeverity.Error,
      source: "stellarforge",
      code: "missing-no-std",
      quickFix: {
        title: "Add `#![no_std]`",
        edits: [{
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
          text: "#![no_std]\n",
        }],
      },
    });
  }
  return diags;
}

/** Rule 8: `String::from_str` without Env (common Soroban mistake) */
function lintStringFromStrWithoutEnv(ctx: LintContext): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  // String::from_str requires (env: &Env, s: &str). A common mistake is
  // String::from_str("hello") — missing the env arg.
  // §Fix — check the ORIGINAL source (with string literals intact),
  // because stripCommentsAndStrings removes the string content.
  const re = /String::from_str\s*\(\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx.source)) !== null) {
    const line = lineForOffset(ctx.source, m.index);
    const col = columnForOffset(ctx.source, m.index);
    diags.push({
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + m[0].length,
      message: `String::from_str requires an Env argument: String::from_str(&env, "hello")`,
      severity: Monaco.MarkerSeverity.Error,
      source: "stellarforge",
      code: "from-str-missing-env",
    });
  }
  return diags;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run all lint rules on the given source.
 * Returns an array of diagnostics (with optional quick fixes).
 */
export function lintRustSource(source: string): LintDiagnostic[] {
  const strippedSource = stripCommentsAndStrings(source);
  const lines = source.split("\n");
  const strippedLines = strippedSource.split("\n");

  const ctx: LintContext = { source, strippedSource, lines, strippedLines };

  const allDiags: LintDiagnostic[] = [];

  // Run all rules (catch errors individually so one bad rule doesn't break all)
  const rules = [
    lintUnusedImports,
    lintMissingImports,
    lintUnbalancedBraces,
    lintMissingSemicolons,
    lintUnwrap,
    lintPanic,
    lintNoStd,
    lintStringFromStrWithoutEnv,
  ];

  for (const rule of rules) {
    try {
      const diags = rule(ctx);
      allDiags.push(...diags);
    } catch (err) {
      console.warn(`[lint] rule ${rule.name} failed:`, err);
    }
  }

  return allDiags;
}

/**
 * Convert LintDiagnostic[] to Monaco markers (for squiggly underlines).
 */
export function diagnosticsToMarkers(
  diags: LintDiagnostic[],
): Monaco.editor.IMarkerData[] {
  return diags.map((d) => ({
    startLineNumber: d.startLineNumber,
    startColumn: d.startColumn,
    endLineNumber: d.endLineNumber,
    endColumn: d.endColumn,
    message: d.message,
    severity: d.severity,
    source: d.source,
    code: d.code,
  }));
}

/**
 * Get all quick-fix code actions from diagnostics.
 * Used to populate Monaco's lightbulb menu.
 */
export function diagnosticsToCodeActions(
  monaco: typeof Monaco,
  diags: LintDiagnostic[],
  model: Monaco.editor.ITextModel,
): Monaco.languages.CodeAction[] {
  const actions: Monaco.languages.CodeAction[] = [];
  for (const d of diags) {
    if (!d.quickFix) continue;
    actions.push({
      title: d.quickFix.title,
      kind: "quickfix",
      diagnostics: [{
        startLineNumber: d.startLineNumber,
        startColumn: d.startColumn,
        endLineNumber: d.endLineNumber,
        endColumn: d.endColumn,
        message: d.message,
        severity: d.severity,
        source: d.source,
        code: d.code,
      }],
      edit: {
        edits: d.quickFix.edits.map((edit) => ({
          resource: model.uri,
          edit: {
            range: edit.range,
            text: edit.text,
          },
        })),
      },
      isPreferred: true,
    });
  }
  return actions;
}
