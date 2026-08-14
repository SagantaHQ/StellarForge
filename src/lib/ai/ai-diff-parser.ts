import { parsePatch } from "diff";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type * as Monaco from "monaco-editor";

/**
 * AI Diff Parser — extracts GitHub-style unified diffs from AI responses
 * and converts them into Monaco editor edit operations.
 *
 * Pipeline (following ChatGPT's recommendation for handling LLM uncertainty):
 *
 *   ┌─────────────────────┐
 *   │  LLM response text  │
 *   └──────────┬──────────┘
 *              │
 *              ▼
 *   ┌──────────────────────────┐
 *   │ Markdown parser (remark) │   ← reliably identifies fenced code blocks
 *   └──────────┬───────────────┘
 *              │
 *              ▼
 *   ┌──────────────────────────────────────┐
 *   │ Validation: try parsePatch() on each │ ← accept only if it parses
 *   └──────────┬───────────────────────────┘   AND returns ≥1 hunk
 *              │
 *              ▼
 *   ┌─────────────────────────────────────┐
 *   │ Raw-text fallback (if no fenced     │ ← scan prose for unfenced
 *   │ diff was successfully parsed)       │   `diff --git` / `--- /+++`
 *   └──────────┬──────────────────────────┘
 *              │
 *              ▼
 *   ┌─────────────────────────┐
 *   │ Merge by filePath       │ ← N diff blocks → 1 AIDiff per file
 *   └─────────────────────────┘
 *
 * Why this matters:
 *   - Markdown parsing handles all fence variants (```, ~~~, trailing
 *     whitespace, missing language tag, missing closing fence, nested
 *     fences, CRLF) — no custom regex can match the coverage of a real
 *     CommonMark parser.
 *   - parsePatch() is the validation gate: it doesn't matter what the
 *     fence language says ('diff', 'patch', 'rust', or empty) — if the
 *     content parses as a unified diff with hunks, we accept it. If it
 *     doesn't parse, we reject it. No more false positives on plain code
 *     blocks that happen to contain `---` comments.
 *   - The raw-text fallback catches the "AI didn't use a code fence"
 *     case (some models just emit the diff inline in prose).
 */

export interface AIDiff {
  filePath: string;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  raw: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  /**
   * Provenance — where did this diff come from?
   *   "fenced": extracted from a fenced code block in the Markdown response
   *   "raw":    extracted from raw prose (no fence around it)
   * Useful for debugging + telemetry — raw-source diffs are lower trust
   * because they're more likely to include prose contamination.
   */
  source: "fenced" | "raw";
}

// ============================================================
// Stage 1: Markdown extraction (uses remark-parse, CommonMark-compliant)
// ============================================================

interface CodeBlock {
  /** The fence language tag (lowercase), e.g. "diff", "patch", "rust", or null */
  lang: string | null;
  /** The raw text inside the fence (no fence markers, no lang line) */
  value: string;
}

/**
 * Lazily-initialized Markdown parser. Calling `.use(remarkParse)` on every
 * request is wasteful — reuse the processor instance. (The processor is
 * stateless after `.parse()` is called; re-running it is safe.)
 */
let parser: ReturnType<typeof unified> | null = null;
function getParser(): ReturnType<typeof unified> {
  if (!parser) parser = unified().use(remarkParse);
  return parser;
}

/**
 * Walk a Markdown AST (mdast) and collect all `code` nodes.
 *
 * CommonMark distinguishes between:
 *   - indented code blocks (no language tag, no fence — four-space indented)
 *   - fenced code blocks (with ``` or ~~~ and an optional info string)
 *
 * remark-parse marks both as `type: "code"`. For fenced blocks, `lang` is
 * the info string (lowercased here); for indented blocks, `lang` is null.
 * Both are surfaced here — the validation step (parsePatch) decides if
 * they're actually diffs.
 */
function extractCodeBlocks(markdown: string): CodeBlock[] {
  // Normalize CRLF → LF so the Markdown parser sees consistent line endings
  // (remark handles \r\n, but normalizing keeps our downstream code simpler).
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const tree = getParser().parse(normalized);
  const blocks: CodeBlock[] = [];

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; lang?: string | null; value?: string; children?: unknown[] };

    if (n.type === "code") {
      blocks.push({
        // remark stores the original case in `lang`; we lowercase for case-insensitive matching later
        lang: (n.lang ?? null)?.toLowerCase() ?? null,
        value: n.value ?? "",
      });
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) visit(child);
    }
  }
  visit(tree);

  return blocks;
}

// ============================================================
// Stage 2: Validation via parsePatch()
// ============================================================

/**
 * Result of attempting to parse a single text block as a unified diff.
 * `ok: false` means the block wasn't a valid diff — caller should ignore it.
 */
interface ParsedPatchResult {
  ok: boolean;
  /** Raw text that was passed to parsePatch (for debugging + the `raw` field on AIDiff) */
  text: string;
  /** Source: where did this text come from? */
  source: "fenced" | "raw";
  /** Parsed patches (only present if ok=true) */
  patches: ReturnType<typeof parsePatch>;
}

/**
 * Try to parse `text` as a unified diff.
 *
 * Returns ok=true ONLY if parsePatch() succeeds AND returns ≥1 patch with
 * ≥1 hunk. parsePatch() is unfortunately very lenient — given a non-diff
 * input it returns `[{ oldFileName: undefined, hunks: [] }]` instead of
 * throwing. So we have to explicitly check for non-empty hunks.
 *
 * Also strips a leading "diff --git" line if present (parsePatch handles
 * it directly, but if the block contains multiple `diff --git` sections,
 * we split on them so each gets its own parsePatch call).
 */
function tryParseAsDiff(text: string, source: "fenced" | "raw"): ParsedPatchResult[] {
  // Normalize whitespace: trim trailing whitespace per line + collapse
  // consecutive blank lines (LLMs sometimes add spurious blank lines that
  // confuse parsePatch's hunk body parsing).
  const normalized = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  // Some LLMs emit multiple `diff --git` sections in one fenced block.
  // parsePatch handles this if you give it the full text, but if there's
  // prose contamination between sections, it gets confused. Split on
  // `diff --git` boundaries and parse each separately.
  const sections = normalized.includes("diff --git ")
    ? splitOnDiffGitSections(normalized)
    : [normalized];

  const results: ParsedPatchResult[] = [];

  for (const section of sections) {
    if (!section.trim()) continue;

    let patches: ReturnType<typeof parsePatch>;
    try {
      patches = parsePatch(section);
    } catch (e) {
      // parsePatch shouldn't throw in practice, but be defensive
      console.error("[ai-diff-parser] parsePatch threw:", e);
      continue;
    }

    // Filter: parsePatch returns empty hunks for non-diff input. Only
    // accept patches that have at least one hunk with at least one line.
    const validPatches = patches.filter(
      (p) => p.hunks && p.hunks.length > 0 && p.hunks.some((h) => h.lines && h.lines.length > 0)
    );

    if (validPatches.length > 0) {
      results.push({ ok: true, text: section, source, patches: validPatches });
    }
  }

  return results;
}

/**
 * Split a text block on `diff --git` boundaries. Each section includes
 * its leading `diff --git` line. Used when a single fenced block contains
 * multiple file patches (common in agentic flows where the AI edits
 * multiple files in one response).
 */
function splitOnDiffGitSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      // Start of a new section — flush the previous one
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));

  return sections;
}

// ============================================================
// Stage 3: Raw-text fallback (no code fence at all)
// ============================================================

/**
 * Scan raw prose for unfenced unified diffs. Used as a fallback when no
 * fenced diff was successfully parsed.
 *
 * Strategy: find every `diff --git` or `--- a/...` marker in the raw
 * text, then expand forward to the end of the diff (heuristic: the diff
 * ends at the next blank line followed by prose, or at end of string).
 *
 * This is intentionally conservative — we'd rather miss a diff than
 * misidentify prose as a patch (false positives would silently corrupt
 * user files on Accept).
 */
function scanRawTextForDiffs(text: string): ParsedPatchResult[] {
  const results: ParsedPatchResult[] = [];

  // Find candidate start positions:
  //   - `diff --git a/X b/Y` (canonical git header)
  //   - `--- a/...` followed (within 5 lines) by `+++ b/...`
  const starts: number[] = [];

  // Pattern 1: diff --git headers
  const diffGitRe = /^diff --git /gm;
  let m: RegExpExecArray | null;
  while ((m = diffGitRe.exec(text)) !== null) {
    starts.push(m.index);
  }

  // Pattern 2: --- / +++ pairs without diff --git (LLM forgot the git header)
  // Look for `--- a/` or `--- /dev/null` lines, then verify `+++` follows within 5 lines.
  const headerRe = /^--- (?:a\/|\.\.\/|\/dev\/null)/gm;
  while ((m = headerRe.exec(text)) !== null) {
    // Verify there's a +++ within the next 5 lines
    const after = text.slice(m.index, m.index + 500);
    if (/^\+\+\+ /m.test(after)) {
      // Avoid double-counting if this is part of a diff --git section
      const alreadyCovered = starts.some((s) => Math.abs(s - m.index!) < 50);
      if (!alreadyCovered) starts.push(m.index!);
    }
  }

  // Sort + dedupe starts
  starts.sort((a, b) => a - b);
  for (let i = 0; i < starts.length; i++) {
    if (i > 0 && starts[i] === starts[i - 1]) continue;
    const start = starts[i];
    // End: next `diff --git` start, or end of string
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const candidate = text.slice(start, end).trim();
    if (!candidate) continue;

    // Try to parse — only accept if parsePatch returns valid hunks
    const parsed = tryParseAsDiff(candidate, "raw");
    results.push(...parsed);
  }

  return results;
}

// ============================================================
// Stage 4: Merge by filePath
// ============================================================

/**
 * Resolve a parsed patch's file path to a known project file.
 * Handles common LLM path quirks:
 *   - `a/path` / `b/path` prefix (git format) — strip
 *   - `/dev/null` (file creation/deletion) — fall back to the other header
 *   - Quoted paths with spaces — strip quotes
 *   - Wrong basename — try fuzzy matching against knownFiles
 */
function resolveFilePath(patch: ReturnType<typeof parsePatch>[number], knownFiles?: string[]): string | null {
  let filePath = patch.newFileName || patch.oldFileName || "";

  // Strip `a/` or `b/` prefix (git format)
  filePath = filePath.replace(/^[ab]\//, "");

  // Handle /dev/null (file creation or deletion)
  if (filePath === "/dev/null" || !filePath) {
    filePath = patch.oldFileName?.replace(/^[ab]\//, "") || "";
    if (filePath === "/dev/null") filePath = "";
  }

  // Strip surrounding quotes if present
  filePath = filePath.replace(/^["']|["']$/g, "").trim();

  if (!filePath) return null;

  // Fuzzy match against known project files
  if (knownFiles && knownFiles.length > 0 && !knownFiles.includes(filePath)) {
    const basename = filePath.split("/").pop();
    if (basename) {
      const match = knownFiles.find(
        (f) => f === filePath || f.endsWith("/" + basename) || f === basename
      );
      if (match) filePath = match;
    }
  }

  return filePath;
}

/**
 * Merges a list of parsed patches into AIDiff objects, grouping all
 * patches for the same file into a single AIDiff with all hunks combined.
 *
 * Without this, an LLM emitting 3 diff blocks for src/lib.rs would
 * produce 3 separate Accept cards — confusing UX. After merge, the user
 * sees ONE card per file with all hunks grouped.
 */
function mergeByFilePath(parsed: ParsedPatchResult[], knownFiles?: string[]): AIDiff[] {
  const byPath = new Map<string, AIDiff>();

  for (const result of parsed) {
    for (const patch of result.patches) {
      const filePath = resolveFilePath(patch, knownFiles);
      if (!filePath) continue; // skip — can't apply without a path

      const isNewFile = patch.oldFileName === "/dev/null" || patch.oldFileName === undefined;
      const isDeletedFile = patch.newFileName === "/dev/null" || patch.newFileName === undefined;
      const newHunks = (patch.hunks || []).map((h) => ({
        oldStart: h.oldStart,
        newStart: h.newStart,
        lines: h.lines,
      }));

      const existing = byPath.get(filePath);
      if (existing) {
        existing.hunks.push(...newHunks);
        existing.raw += "\n\n" + result.text;
        // Promote source from "raw" to "fenced" if we have at least one
        // fenced contribution (fenced is more trustworthy).
        if (result.source === "fenced") existing.source = "fenced";
        // Update create/delete flags
        if (!existing.isNewFile && isNewFile) existing.isNewFile = true;
        if (!existing.isDeletedFile && isDeletedFile) existing.isDeletedFile = true;
      } else {
        byPath.set(filePath, {
          filePath,
          hunks: newHunks,
          raw: result.text,
          isNewFile,
          isDeletedFile,
          source: result.source,
        });
      }
    }
  }

  return Array.from(byPath.values());
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Extracts and parses GitHub-style unified diffs from an AI response.
 *
 * Strategy (in order):
 *   1. Parse the response as Markdown (remark/CommonMark) to reliably
 *      identify all fenced code blocks — handles all fence variants
 *      (```, ~~~, no lang, trailing whitespace, missing close, CRLF).
 *   2. For each fenced block, try parsePatch() and accept it only if it
 *      parses AND returns ≥1 hunk. The fence language tag ('diff',
 *      'patch', 'rust', or empty) doesn't matter — content is the source
 *      of truth.
 *   3. If NO fenced diff was successfully parsed, fall back to scanning
 *      raw prose for unfenced `diff --git` / `--- /+++` patterns.
 *   4. Merge multiple diff blocks targeting the same file into a single
 *      AIDiff with all hunks grouped (one Accept card per file).
 *
 * @param aiResponse The raw LLM response text
 * @param knownFiles  Project file paths — used to fuzzy-match LLM-claimed
 *                    paths against real files (handles missing `a/`/`b/`
 *                    prefixes, wrong directories, etc.)
 */
export function extractAndParseDiffs(aiResponse: string, knownFiles?: string[]): AIDiff[] {
  if (!aiResponse || !aiResponse.trim()) return [];

  // Stage 1: Markdown extraction
  const codeBlocks = extractCodeBlocks(aiResponse);

  // Stage 2: Validation — try parsePatch on every code block
  const fencedPatches: ParsedPatchResult[] = [];
  for (const block of codeBlocks) {
    if (!block.value.trim()) continue;
    // We don't filter by `lang` here — content is the source of truth.
    // Even a `rust`-tagged block can contain a diff if the LLM is confused.
    fencedPatches.push(...tryParseAsDiff(block.value, "fenced"));
  }

  // Stage 3: Raw-text fallback — only if no fenced diff was successfully parsed
  let rawPatches: ParsedPatchResult[] = [];
  if (fencedPatches.length === 0) {
    rawPatches = scanRawTextForDiffs(aiResponse);
  }

  const allPatches = [...fencedPatches, ...rawPatches];

  // Stage 4: Merge by filePath
  return mergeByFilePath(allPatches, knownFiles);
}

// ============================================================
// Monaco edit operations (unchanged from previous version)
// ============================================================

/**
 * Converts a parsed diff hunk into Monaco editor edit operations.
 * Groups consecutive deletions + additions into single edit operations
 * for cleaner undo history.
 */
export function getMonacoEditsFromHunk(
  hunk: { oldStart: number; newStart: number; lines: string[] },
  monaco: typeof Monaco
): Monaco.editor.IIdentifiedSingleEditOperation[] {
  const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [];
  let currentLine = hunk.oldStart;
  let i = 0;

  while (i < hunk.lines.length) {
    const line = hunk.lines[i];

    if (line.startsWith(" ")) {
      // Context line — skip
      currentLine++;
      i++;
    } else if (line.startsWith("-")) {
      // Deletion (possibly followed by additions = replacement)
      const startLine = currentLine;
      let removeCount = 0;

      while (i < hunk.lines.length && hunk.lines[i].startsWith("-")) {
        removeCount++;
        i++;
      }

      // Check for following additions (replacement)
      let addText = "";
      let addCount = 0;

      while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
        addText += (addCount > 0 ? "\n" : "") + hunk.lines[i].substring(1);
        addCount++;
        i++;
      }

      // Build the edit operation
      // If we have additions, the replacement text is addText
      // If no additions, we're just deleting (empty replacement)
      const text = addCount > 0 ? addText : "";

      edits.push({
        range: new monaco.Range(startLine, 1, startLine + removeCount, 1),
        text: text,
        forceMoveMarkers: true,
      });

      currentLine += removeCount;
    } else if (line.startsWith("+")) {
      // Pure addition (no preceding deletion)
      const startLine = currentLine;
      let addText = "";
      let addCount = 0;

      while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
        addText += (addCount > 0 ? "\n" : "") + hunk.lines[i].substring(1);
        addCount++;
        i++;
      }

      edits.push({
        range: new monaco.Range(startLine, 1, startLine, 1),
        text: addText + "\n",
        forceMoveMarkers: true,
      });
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
      i++;
    } else {
      // Unknown line — skip
      i++;
    }
  }

  return edits;
}

/**
 * Converts a full AIDiff into Monaco edit operations.
 */
export function getMonacoEditsFromDiff(
  diff: AIDiff,
  monaco: typeof Monaco
): Monaco.editor.IIdentifiedSingleEditOperation[] {
  const allEdits: Monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (const hunk of diff.hunks) {
    const edits = getMonacoEditsFromHunk(hunk, monaco);
    allEdits.push(...edits);
  }
  return allEdits;
}

/**
 * Applies a diff to file content as a string (non-Monaco).
 * Used when the editor isn't available or for file system store updates.
 *
 * Graceful failure: each hunk is applied independently. If a hunk's
 * context can't be found at the expected position (or within ±15 lines
 * for fuzzy matching), that hunk is SKIPPED with a console.error —
 * the remaining hunks still apply. This is safer than all-or-nothing
 * because a single stale hunk shouldn't prevent the user from accepting
 * a multi-file fix that's otherwise valid.
 *
 * Returns the updated content. If NO hunks applied, returns null so the
 * caller (agent-panel) can fall back to the legacy applyDiffToFile.
 */
export function applyDiffToContent(content: string, diff: AIDiff): string | null {
  const lines = content.split("\n");
  let applied = false;

  // Process hunks in REVERSE order of oldStart so earlier hunks' line
  // numbers don't shift when later hunks are applied.
  const sortedHunks = [...diff.hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedHunks) {
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of hunk.lines) {
      // Skip the patch header lines that parsePatch may have left in
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("@@")) continue;
      if (line.startsWith("-")) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith("+")) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(" ")) {
        const ctx = line.substring(1);
        oldLines.push(ctx);
        newLines.push(ctx);
      } else if (line === "") {
        // LLMs often drop the leading space on blank context lines.
        oldLines.push("");
        newLines.push("");
      } else if (line.startsWith("\\")) {
        continue;
      } else {
        // Unknown line — push as context (parsePatch should have handled this)
        oldLines.push(line);
        newLines.push(line);
      }
    }

    // Strategy 1: Exact match at hunk.oldStart position.
    const startIdx = Math.max(0, hunk.oldStart - 1);
    let matchIdx = -1;

    if (
      oldLines.length > 0 &&
      startIdx + oldLines.length <= lines.length &&
      lines.slice(startIdx, startIdx + oldLines.length).join("\n") === oldLines.join("\n")
    ) {
      matchIdx = startIdx;
    }

    // Strategy 2: Fuzzy search ±15 lines around expected position.
    if (matchIdx === -1 && oldLines.length > 0) {
      for (let offset = -15; offset <= 15; offset++) {
        const idx = startIdx + offset;
        if (idx < 0 || idx + oldLines.length > lines.length) continue;
        if (lines.slice(idx, idx + oldLines.length).join("\n") === oldLines.join("\n")) {
          matchIdx = idx;
          if (offset !== 0) {
            console.warn(
              `[ai-diff-parser] hunk @@ -${hunk.oldStart} +${hunk.newStart} @@ ` +
              `applied at line ${idx + 1} (offset ${offset}) — file may have drifted`
            );
          }
          break;
        }
      }
    }

    // Strategy 3: Pure insertion (no context, no deletions).
    if (matchIdx === -1 && oldLines.length === 0 && newLines.length > 0) {
      lines.splice(startIdx, 0, ...newLines);
      applied = true;
      continue;
    }

    if (matchIdx === -1) {
      console.error(
        `[ai-diff-parser] could not apply hunk @@ -${hunk.oldStart} +${hunk.newStart} @@ ` +
        `for ${diff.filePath} — context not found at expected position or within ±15 lines. Skipping.`,
        { oldLinesPreview: oldLines.slice(0, 3), expectedStart: startIdx }
      );
      continue;
    }

    lines.splice(matchIdx, oldLines.length, ...newLines);
    applied = true;
  }

  return applied ? lines.join("\n") : null;
}
