import { parsePatch } from "diff";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type * as Monaco from "monaco-editor";

/**
 * AI Diff Parser — extracts GitHub-style unified diffs from AI responses
 * and converts them into Monaco editor edit operations.
 *
 * Pipeline (primary path uses custom delimiters, fallback uses Markdown):
 *
 *   ┌─────────────────────┐
 *   │  LLM response text  │
 *   └──────────┬──────────┘
 *              │
 *              ▼
 *   ┌─────────────────────────────────────────┐
 *   │ Stage 1: Custom delimiter extraction    │ ← PRIMARY — simplest + most reliable
 *   │ Look for DIFF_START_DELIM + content +   │   (the system prompt instructs the
 *   │ DIFF_END_DELIM. Extract content.        │    model to use these delimiters)
 *   └──────────┬─────────────────────────────┘
 *              │
 *              ▼
 *   ┌──────────────────────────────────────┐
 *   │ Stage 2: Markdown parser (remark)    │ ← FALLBACK — handles old chat
 *   │ Walk AST for fenced code blocks.      │   history + models that ignored
 *   │ Validation via parsePatch().          │   the delimiter instruction
 *   └──────────┬───────────────────────────┘
 *              │
 *              ▼
 *   ┌─────────────────────────────────────┐
 *   │ Stage 3: Raw-text fallback          │ ← last resort — scans prose
 *   │ (only if no diff was parsed above)  │   for unfenced `diff --git`
 *   └──────────┬──────────────────────────┘
 *              │
 *              ▼
 *   ┌─────────────────────────┐
 *   │ Merge by filePath       │ ← N diff blocks → 1 AIDiff per file
 *   └─────────────────────────┘
 *
 * Why custom delimiters are the primary path:
 *   - The model EXPLICITLY marks "this is the diff" vs "this is analysis"
 *     — no ambiguity about whether a ```rust block is a diff or just code
 *   - No fence-language ambiguity (`diff` vs `Diff` vs `patch` vs no-lang)
 *   - No CRLF normalization / missing-close-fence tolerance needed
 *   - Parser is trivial: find start, find end, extract — no regex
 *   - This is the same approach used by GitHub Copilot, Continue.dev, Aider
 *
 * The Markdown + raw-text fallbacks are kept so old chat history (which
 * used ```diff fences) still works, and so models that ignore the delimiter
 * instruction still produce a parseable diff via the old path.
 */

/**
 * Custom delimiters for marking the start + end of a code/diff block.
 *
 * Why these specific strings:
 *   - `>>` (arrows pointing right) at the start = "code coming IN here"
 *   - `<<` (arrows pointing left) at the end = "code going OUT here"
 *   - The `+` prefix makes them visually distinct + unlikely to appear
 *     in normal code/prose (10 pluses is way more than anyone would type
 *     by accident)
 *   - Both delimiters are exactly the same length (24 chars) for symmetry
 *
 * The system prompt instructs the model to wrap every diff in these
 * delimiters. The parser extracts whatever is between them — no fence
 * regex, no parsePatch validation needed for extraction (validation still
 * happens, but extraction is trivial).
 *
 * Example model output:
 *
 *   The error is caused by String::from_str not existing. Fix:
 *
 *   ++++++++++>>>>>>>>>>
 *   --- a/src/lib.rs
 *   ++++ b/src/lib.rs
 *   @@ -10,3 +10,3 @@
 *    context
 *   -old line
 *   +new line
 *   <<<<<<<<<<++++++++++
 *
 *   Let me know if you need anything else.
 */
export const DIFF_START_DELIMITER = "++++++++++>>>>>>>>>>";
export const DIFF_END_DELIMITER = "<<<<<<<<<<++++++++++";

export interface AIDiff {
  filePath: string;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  raw: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  /**
   * Provenance — where did this diff come from?
   *   "delimited": extracted via custom DIFF_START/END delimiters (PRIMARY)
   *   "fenced":    extracted from a fenced code block in the Markdown response (FALLBACK)
   *   "raw":       extracted from raw prose (no fence around it) (LAST RESORT)
   * Useful for debugging + telemetry — delimited-source diffs are highest
   * trust because the model explicitly marked them.
   */
  source: "delimited" | "fenced" | "raw";
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
  source: "delimited" | "fenced" | "raw";
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
function tryParseAsDiff(text: string, source: "delimited" | "fenced" | "raw"): ParsedPatchResult[] {
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

  // Source priority for the merged AIDiff: delimited > fenced > raw.
  // (If a file has diffs from multiple sources, the highest-trust source wins.)
  const sourcePriority: Record<AIDiff["source"], number> = {
    delimited: 3,
    fenced: 2,
    raw: 1,
  };

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
        // Promote source if this contribution is higher-trust than the
        // existing one (e.g. a delimited contribution promotes a fenced one).
        if (sourcePriority[result.source] > sourcePriority[existing.source]) {
          existing.source = result.source;
        }
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
// Stage 0: Custom-delimiter extraction (PRIMARY — simplest + most reliable)
// ============================================================

/**
 * Extract diffs marked with custom DIFF_START_DELIMITER / DIFF_END_DELIMITER
 * pairs. This is the PRIMARY extraction path — the system prompt instructs
 * the model to wrap every diff in these delimiters.
 *
 * Why this is simpler + more reliable than Markdown fence extraction:
 *   - No fence-language ambiguity (`diff` vs `Diff` vs `patch` vs no-lang)
 *   - No CRLF normalization needed (we split on \n which handles \r\n too)
 *   - No missing-close-fence tolerance needed (we scan to end of string
 *     if no end delimiter is found)
 *   - No Markdown AST overhead (just two indexOf() calls per block)
 *   - The model EXPLICITLY marks "this is the diff" vs "this is analysis"
 *
 * Multiple delimiter pairs are supported — the model can emit one pair
 * per file in a multi-file change. Each pair is parsed independently via
 * tryParseAsDiff (which handles multi-section `diff --git` blocks too).
 *
 * Edge cases:
 *   - Start delimiter with no end delimiter → extract to end of string
 *     (the model may have been cut off mid-response)
 *   - End delimiter with no start delimiter → ignored (likely a typo
 *     or the model is showing the delimiter as an example)
 *   - Empty content between delimiters → skipped (no diff to parse)
 *   - Content that isn't a valid diff → tryParseAsDiff returns ok=false,
 *     the block is silently dropped (no false positives)
 */
function extractDelimitedDiffs(text: string): ParsedPatchResult[] {
  const results: ParsedPatchResult[] = [];

  // Normalize CRLF → LF so the delimiter search works regardless of
  // how the response was transported. (The delimiters themselves don't
  // contain \r or \n, so this is just defensive.)
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let searchFrom = 0;
  while (true) {
    const startIdx = normalized.indexOf(DIFF_START_DELIMITER, searchFrom);
    if (startIdx === -1) break; // no more start delimiters

    // Content starts AFTER the start delimiter (skip the delimiter itself
    // + any trailing whitespace/newline on the same line)
    const contentStart = startIdx + DIFF_START_DELIMITER.length;
    // Skip a single trailing newline if present (common — the model puts
    // the diff on the next line after the delimiter)
    let contentBegin = contentStart;
    if (normalized[contentBegin] === "\n") contentBegin++;
    else if (normalized[contentBegin] === "\r" && normalized[contentBegin + 1] === "\n") contentBegin += 2;

    // Find the matching end delimiter (search forward from content start)
    let endIdx = normalized.indexOf(DIFF_END_DELIMITER, contentBegin);

    let content: string;
    if (endIdx === -1) {
      // No end delimiter found — extract to end of string.
      // (The model may have been cut off, or forgot to close the block.
      // Better to try parsing what we have than to silently drop it.)
      content = normalized.slice(contentBegin);
      // Try to parse it — if it's a valid diff, great; if not, the user
      // sees the "no diff detected" affordance and can ask the agent
      // to retry.
      const parsed = tryParseAsDiff(content, "delimited");
      if (parsed.length > 0 && parsed.some((p) => p.ok)) {
        results.push(...parsed.filter((p) => p.ok));
      }
      break; // no more delimiters to find
    } else {
      // End delimiter found — extract content between start + end.
      // Trim trailing whitespace/newline from the content (the model
      // often puts the end delimiter on its own line, so there's a \n
      // right before it)
      content = normalized.slice(contentBegin, endIdx).replace(/\s+$/, "");
      const parsed = tryParseAsDiff(content, "delimited");
      if (parsed.length > 0 && parsed.some((p) => p.ok)) {
        results.push(...parsed.filter((p) => p.ok));
      }
      // Move search past this end delimiter for the next iteration
      searchFrom = endIdx + DIFF_END_DELIMITER.length;
    }
  }

  return results;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Extracts and parses GitHub-style unified diffs from an AI response.
 *
 * Strategy (in order of priority):
 *   0. PRIMARY: Look for custom DIFF_START_DELIMITER / DIFF_END_DELIMITER
 *      pairs. The system prompt instructs the model to use these —
 *      extraction is trivial (find start, find end, extract content).
 *   1. FALLBACK: Parse the response as Markdown (remark/CommonMark) to
 *      identify fenced code blocks. Handles old chat history + models
 *      that ignored the delimiter instruction.
 *   2. LAST RESORT: Scan raw prose for unfenced `diff --git` / `--- /+++`
 *      patterns (some models emit the diff inline without any wrapping).
 *   3. Merge multiple diff blocks targeting the same file into a single
 *      AIDiff with all hunks grouped (one Accept card per file).
 *
 * The delimited path is tried FIRST because:
 *   - It's the highest-trust source (model explicitly marked the diff)
 *   - It's the simplest + most reliable (no regex, no AST)
 *   - If it succeeds, we don't need the Markdown/raw fallbacks
 *
 * The Markdown + raw-text fallbacks are kept so:
 *   - Old chat history (which used ```diff fences) still works
 *   - Models that ignore the delimiter instruction still produce a
 *     parseable diff via the old path
 *
 * @param aiResponse The raw LLM response text
 * @param knownFiles  Project file paths — used to fuzzy-match LLM-claimed
 *                    paths against real files (handles missing `a/`/`b/`
 *                    prefixes, wrong directories, etc.)
 */
export function extractAndParseDiffs(aiResponse: string, knownFiles?: string[]): AIDiff[] {
  if (!aiResponse || !aiResponse.trim()) return [];

  // Stage 0 (PRIMARY): Custom-delimiter extraction
  const delimitedPatches = extractDelimitedDiffs(aiResponse);

  // If delimited extraction found diffs, we still run the Markdown fallback
  // + merge — the model might have used BOTH delimiters AND ```diff fences
  // (e.g. delimited for the main diff, fenced for an example). Merging
  // ensures we capture everything + dedupe by filePath.
  // (If you want STRICT delimited-only mode, return early here when
  // delimitedPatches.length > 0.)

  // Stage 1 (FALLBACK): Markdown extraction
  const codeBlocks = extractCodeBlocks(aiResponse);

  // Stage 2: Validation — try parsePatch on every code block
  const fencedPatches: ParsedPatchResult[] = [];
  for (const block of codeBlocks) {
    if (!block.value.trim()) continue;
    // We don't filter by `lang` here — content is the source of truth.
    // Even a `rust`-tagged block can contain a diff if the LLM is confused.
    fencedPatches.push(...tryParseAsDiff(block.value, "fenced"));
  }

  // Stage 3 (LAST RESORT): Raw-text fallback — only if no delimited OR
  // fenced diff was successfully parsed
  let rawPatches: ParsedPatchResult[] = [];
  if (delimitedPatches.length === 0 && fencedPatches.length === 0) {
    rawPatches = scanRawTextForDiffs(aiResponse);
  }

  const allPatches = [...delimitedPatches, ...fencedPatches, ...rawPatches];

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
