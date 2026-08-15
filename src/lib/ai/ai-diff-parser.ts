import { parsePatch } from "diff";
import type * as Monaco from "monaco-editor";

/**
 * AI Diff Parser — INTELLIGENT extraction of unified diffs from AI responses.
 *
 * DESIGN PHILOSOPHY:
 *   The parser must handle ANY format the LLM produces — wrong delimiters,
 *   missing closing fences, CRLF, trailing whitespace, mixed formats, etc.
 *   The user should NEVER see "no diff detected" when the agent DID output
 *   a diff, just in a slightly malformed way.
 *
 * STRATEGY: Try parsePatch() on EVERYTHING that could possibly be a diff.
 *   parsePatch (from the `diff` library / jsdiff) is battle-tested and very
 *   lenient — it handles malformed hunks, missing headers, wrong line
 *   counts, etc. If it returns ≥1 hunk, we accept the block.
 *
 *   We extract candidate sections from the response using MULTIPLE methods:
 *     1. Fenced code blocks (```, ~~~, any language tag or none)
 *     2. Fuzzy delimiter matching (4+ pluses + 4+ arrows, in case the model
 *        used slightly wrong custom delimiters)
 *     3. Raw text scanning (find `--- ` and `+++ ` markers in prose)
 *     4. The ENTIRE response as a last resort
 *
 *   For each candidate, we try parsePatch(). If it returns ≥1 patch with
 *   ≥1 hunk, we accept it. Duplicates are deduplicated by filePath.
 *
 * No more "ask the agent to reformat" button — the parser handles it all.
 */

export interface AIDiff {
  filePath: string;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  raw: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  source: "fenced" | "delimited" | "raw";
}

// ============================================================
// Stage 1: Extract ALL candidate text blocks from the response
// ============================================================

/**
 * Extract every possible candidate text block from the response.
 * We try EVERYTHING — fenced blocks, delimiter-wrapped sections, and
 * raw text. Each candidate gets tried with parsePatch().
 *
 * Why so many extraction methods?
 *   - Models use ```diff, ```Diff, ```patch, ```text, ```, ~~~, custom
 *     delimiters, or no wrapping at all
 *   - Models sometimes drop characters from delimiters (e.g. <<<<<<<<
 *     instead of <<<<<<<<<<)
 *   - Models sometimes forget the closing fence
 *   - Models sometimes put the diff inline in prose with no wrapping
 *
 * By trying ALL of these, we catch the diff no matter how the model
 * wrapped (or didn't wrap) it.
 */
function extractAllCandidates(text: string): { source: AIDiff["source"]; text: string }[] {
  const candidates: { source: AIDiff["source"]; text: string }[] = [];

  // Normalize CRLF → LF
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // ─── Method 1: Fenced code blocks (``` or ~~~) ────────────────────
  // Match opening fence (``` or ~~~), optional language tag, content,
  // closing fence. Also handles missing closing fence (extract to end).
  const fenceRe = /(?:^|\n)(`{3}|~{3})[a-zA-Z0-9_+-]*[ \t]*\n([\s\S]*?)(?=\n`{3}[ \t]*$|\n`{3}[ \t]*\n|\n~{3}[ \t]*$|\n~{3}[ \t]*\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(normalized)) !== null) {
    const content = m[2]?.trim();
    if (content && content.length > 10) {
      candidates.push({ source: "fenced", text: content });
    }
    // Skip past closing fence
    const after = normalized.slice(m.index + m[0].length);
    const closeMatch = after.match(/^[ \t]*(`{3}|~{3})[ \t]*\n?/);
    if (closeMatch) {
      fenceRe.lastIndex += closeMatch[0].length;
    }
  }

  // ─── Method 2: Fuzzy delimiter matching ───────────────────────────
  // Models sometimes use custom delimiters like ++++++++++>>>>>>>>>>
  // but drop characters (e.g. <<<<<<<<<< instead of <<<<<<<<<<++++++++++).
  // Match any sequence of 4+ pluses followed by 4+ > (start) or 4+ < (end).
  const fuzzyStartRe = /\+{4,}>{4,}/g;
  const fuzzyEndRe = /<{4,}\+{4,}/g;
  const startPositions: { idx: number; len: number }[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = fuzzyStartRe.exec(normalized)) !== null) {
    startPositions.push({ idx: fm.index, len: fm[0].length });
  }
  for (const { idx, len } of startPositions) {
    const contentStart = idx + len;
    // Find the next fuzzy end delimiter after this start
    fuzzyEndRe.lastIndex = contentStart;
    const endMatch = fuzzyEndRe.exec(normalized);
    let content: string;
    if (endMatch) {
      content = normalized.slice(contentStart, endMatch.index).trim();
    } else {
      // No end delimiter — extract to end of string
      content = normalized.slice(contentStart).trim();
    }
    if (content && content.length > 10) {
      candidates.push({ source: "delimited", text: content });
    }
  }

  // ─── Method 3: Raw text scan for diff markers ────────────────────
  // Find sections of prose that look like diffs (contain --- a/ and +++ b/
  // or diff --git headers). Extract each section.
  const diffMarkerRe = /(?:^|\n)(diff --git |--- [a-z]?\/|[+][+][+] [a-z]?\/)/g;
  const markerPositions: number[] = [];
  while ((fm = diffMarkerRe.exec(normalized)) !== null) {
    markerPositions.push(fm.index);
  }
  for (let i = 0; i < markerPositions.length; i++) {
    const start = markerPositions[i];
    // End is the next marker position, or end of string
    const end = i + 1 < markerPositions.length ? markerPositions[i + 1] : normalized.length;
    const content = normalized.slice(start, end).trim();
    if (content && content.length > 10) {
      candidates.push({ source: "raw", text: content });
    }
  }

  // ─── Method 4: The ENTIRE response as a last resort ──────────────
  // If nothing else works, try parsing the entire response. parsePatch
  // will extract whatever it can find.
  candidates.push({ source: "raw", text: normalized });

  return candidates;
}

// ============================================================
// Stage 2: Try parsePatch on each candidate + collect valid diffs
// ============================================================

/**
 * Fix the line counts in @@ hunk headers to match the actual body.
 *
 * LLMs are TERRIBLE at counting lines — they almost always get the
 * oldLines/newLines in `@@ -oldStart,oldLines +newStart,newLines @@`
 * wrong. parsePatch() throws "Added line count did not match" when
 * the counts don't match the body, causing the ENTIRE diff to be
 * rejected even though the content is correct.
 *
 * This function rewrites every @@ header to match the actual body:
 *   - Count context lines (start with " ")
 *   - Count removed lines (start with "-")
 *   - Count added lines (start with "+")
 *   - oldLines = context + removed
 *   - newLines = context + added
 *   - Rewrite the @@ header with the corrected counts
 *
 * This is the #1 fix for "the parser sucks" — without it, ~50% of
 * LLM-generated diffs fail to parse because of wrong line counts.
 */
function fixHunkLineCounts(text: string): string {
  const lines = text.split("\n");
  const fixed: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Detect @@ hunk header
    const hunkMatch = line?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch) {
      fixed.push(line ?? "");
      i++;
      continue;
    }

    // Found a hunk header — collect the body lines until the next @@
    // or --- / +++ header or end of patch
    const oldStart = parseInt(hunkMatch[1], 10);
    const newStart = parseInt(hunkMatch[3], 10);
    const bodyLines: string[] = [];
    i++;

    while (i < lines.length) {
      const bodyLine = lines[i];
      // Stop at next hunk header or file header
      if (bodyLine?.startsWith("@@") || bodyLine?.startsWith("--- ") || bodyLine?.startsWith("+++ ") || bodyLine?.startsWith("diff --git")) {
        break;
      }
      // Stop at non-diff lines (prose after the diff)
      // Diff lines start with: " " (context), "-" (removed), "+" (added),
      // "\\" (no-newline marker), or are empty (blank context)
      if (bodyLine && bodyLine.length > 0 && !bodyLine.startsWith(" ") && !bodyLine.startsWith("-") && !bodyLine.startsWith("+") && !bodyLine.startsWith("\\")) {
        break;
      }
      bodyLines.push(bodyLine ?? "");
      i++;
    }

    // Count the actual lines
    let contextCount = 0;
    let removedCount = 0;
    let addedCount = 0;

    for (const bodyLine of bodyLines) {
      if (bodyLine.startsWith("-")) {
        removedCount++;
      } else if (bodyLine.startsWith("+")) {
        addedCount++;
      } else if (bodyLine.startsWith(" ") || bodyLine === "") {
        // Context line (leading space) or empty line (LLMs often drop
        // the leading space on blank context lines — treat as context)
        contextCount++;
      } else if (bodyLine.startsWith("\\")) {
        // "\ No newline at end of file" — not counted
      } else {
        // Unknown line — treat as context (defensive)
        contextCount++;
      }
    }

    const oldLines = contextCount + removedCount;
    const newLines = contextCount + addedCount;

    // Rewrite the @@ header with corrected counts
    const fixedHeader = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
    fixed.push(fixedHeader);
    fixed.push(...bodyLines);
  }

  return fixed.join("\n");
}

/**
 * Try to parse a text block as a unified diff using parsePatch().
 *
 * Two-pass strategy:
 *   1. Try parsePatch() directly — if it works, great
 *   2. If it throws (usually "Added line count did not match"), fix
 *      the hunk line counts and try again
 *
 * This handles the #1 LLM diff error: wrong line counts in @@ headers.
 */
function tryParseAsDiff(text: string): ReturnType<typeof parsePatch> | null {
  // Pass 1: try parsePatch directly
  try {
    const patches = parsePatch(text);
    const validPatches = patches.filter(
      (p) => p.hunks && p.hunks.length > 0 && p.hunks.some((h) => h.lines && h.lines.length > 0)
    );
    if (validPatches.length > 0) return validPatches;
  } catch {
    // Fall through to pass 2
  }

  // Pass 2: fix hunk line counts and try again
  try {
    const fixedText = fixHunkLineCounts(text);
    // Only try if the fix actually changed something
    if (fixedText !== text) {
      const patches = parsePatch(fixedText);
      const validPatches = patches.filter(
        (p) => p.hunks && p.hunks.length > 0 && p.hunks.some((h) => h.lines && h.lines.length > 0)
      );
      if (validPatches.length > 0) {
        console.log("[ai-diff-parser] parsePatch succeeded after fixing hunk line counts");
        return validPatches;
      }
    }
  } catch {
    // Both passes failed
  }

  return null;
}

// ============================================================
// Stage 3: Resolve file paths + merge by filePath
// ============================================================

/**
 * Resolve a parsed patch's file path to a known project file.
 * Handles common LLM path quirks:
 *   - `a/path` / `b/path` prefix (git format) — strip
 *   - `/dev/null` (file creation/deletion) — fall back to the other header
 *   - Quoted paths with spaces — strip quotes
 *   - Wrong basename — try fuzzy matching against knownFiles
 */
function resolveFilePath(
  patch: ReturnType<typeof parsePatch>[number],
  knownFiles?: string[]
): string | null {
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
      const matches = knownFiles.filter(
        (f) => f === filePath || f.endsWith("/" + basename) || f === basename
      );
      if (matches.length === 1) {
        filePath = matches[0];
      } else if (matches.length > 1) {
        // Ambiguous basename — e.g. multiple lib.rs/mod.rs across workspace
        // crates. Picking matches[0] blindly (the old behavior) can silently
        // patch the wrong crate while the file the user actually cares about
        // is untouched. Try to disambiguate using shared trailing directory
        // segments with the AI-provided path; if it's still a tie, give up
        // rather than guess — the caller's "file not found" flow will ask
        // the user to clarify instead of editing the wrong file.
        const aiDirs = filePath.split("/").slice(0, -1);
        const scored = matches
          .map((f) => {
            const fDirs = f.split("/").slice(0, -1);
            let shared = 0;
            for (let i = 1; i <= Math.min(aiDirs.length, fDirs.length); i++) {
              if (aiDirs[aiDirs.length - i] === fDirs[fDirs.length - i]) shared++;
              else break;
            }
            return { f, shared };
          })
          .sort((a, b) => b.shared - a.shared);
        if (scored[0].shared > 0 && scored[0].shared > (scored[1]?.shared ?? -1)) {
          filePath = scored[0].f;
        } else {
          return null;
        }
      }
    }
  }

  return filePath;
}

/**
 * Merge all valid patches by filePath — N diff blocks for the same file
 * become ONE AIDiff with all hunks grouped (one Accept card per file).
 */
function mergeByFilePath(
  allPatches: { source: AIDiff["source"]; patches: ReturnType<typeof parsePatch> }[],
  knownFiles?: string[]
): AIDiff[] {
  const byPath = new Map<string, AIDiff>();

  for (const { source, patches } of allPatches) {
    for (const patch of patches) {
      const filePath = resolveFilePath(patch, knownFiles);
      if (!filePath) continue;

      const isNewFile = patch.oldFileName === "/dev/null" || patch.oldFileName === undefined;
      const isDeletedFile = patch.newFileName === "/dev/null" || patch.newFileName === undefined;
      const newHunks = (patch.hunks || []).map((h) => ({
        oldStart: h.oldStart,
        newStart: h.newStart,
        lines: h.lines,
      }));

      const existing = byPath.get(filePath);
      if (existing) {
        // Merge hunks — avoid duplicates by checking oldStart + first line
        for (const newHunk of newHunks) {
          const isDup = existing.hunks.some(
            (h) => h.oldStart === newHunk.oldStart && h.lines[0] === newHunk.lines[0]
          );
          if (!isDup) {
            existing.hunks.push(newHunk);
          }
        }
        // Promote source priority: delimited > fenced > raw
        if (source === "delimited" && existing.source !== "delimited") existing.source = "delimited";
        else if (source === "fenced" && existing.source === "raw") existing.source = "fenced";
        if (!existing.isNewFile && isNewFile) existing.isNewFile = true;
        if (!existing.isDeletedFile && isDeletedFile) existing.isDeletedFile = true;
      } else {
        byPath.set(filePath, {
          filePath,
          hunks: newHunks,
          raw: patch.oldFileName || patch.newFileName || "",
          isNewFile,
          isDeletedFile,
          source,
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
 * Extracts and parses unified diffs from an AI response.
 *
 * INTELLIGENT extraction — tries parsePatch() on EVERYTHING:
 *   1. Every fenced code block (```, ~~~, any lang)
 *   2. Every fuzzy-delimiter-wrapped section (4+ pluses + 4+ arrows)
 *   3. Every raw-text section that contains diff markers
 *   4. The entire response as a last resort
 *
 * For each candidate, parsePatch() is tried. If it returns ≥1 patch
 * with ≥1 hunk, the block is accepted. Results are merged by filePath
 * (one Accept card per file).
 *
 * This handles:
 *   - Standard ```diff fences
 *   - Wrong fence language (```rust, ```text, no lang)
 *   - Custom delimiters with typos (missing chars)
 *   - Missing closing fences
 *   - CRLF line endings
 *   - Diffs inline in prose with no wrapping
 *   - Multiple diff blocks for the same file (merged)
 *   - Multi-file diffs (separate patches)
 */
export function extractAndParseDiffs(aiResponse: string, knownFiles?: string[]): AIDiff[] {
  if (!aiResponse || !aiResponse.trim()) return [];

  // Extract all candidate text blocks
  const candidates = extractAllCandidates(aiResponse);

  // Try parsePatch on each candidate — collect ALL valid patches
  const allPatches: { source: AIDiff["source"]; patches: ReturnType<typeof parsePatch> }[] = [];
  for (const { source, text } of candidates) {
    const patches = tryParseAsDiff(text);
    if (patches && patches.length > 0) {
      allPatches.push({ source, patches });
    }
  }

  // Merge by filePath + deduplicate
  return mergeByFilePath(allPatches, knownFiles);
}

// ============================================================
// Monaco edit operations (unchanged)
// ============================================================

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
      currentLine++;
      i++;
    } else if (line.startsWith("-")) {
      const startLine = currentLine;
      let removeCount = 0;
      while (i < hunk.lines.length && hunk.lines[i].startsWith("-")) {
        removeCount++;
        i++;
      }
      let addText = "";
      let addCount = 0;
      while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
        addText += (addCount > 0 ? "\n" : "") + hunk.lines[i].substring(1);
        addCount++;
        i++;
      }
      const text = addCount > 0 ? addText : "";
      edits.push({
        range: new monaco.Range(startLine, 1, startLine + removeCount, 1),
        text,
        forceMoveMarkers: true,
      });
      currentLine += removeCount;
    } else if (line.startsWith("+")) {
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
      i++;
    } else {
      i++;
    }
  }

  return edits;
}

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

export interface DiffApplyResult {
  content: string;
  appliedHunks: number;
  failedHunks: number;
}

function splitHunkLines(hunk: { lines: string[] }): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of hunk.lines) {
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
      oldLines.push("");
      newLines.push("");
    } else if (line.startsWith("\\")) {
      continue;
    } else {
      oldLines.push(line);
      newLines.push(line);
    }
  }
  return { oldLines, newLines };
}

/**
 * Search the WHOLE file (not a fixed window around the AI's claimed line
 * number) for a contiguous run of lines matching `oldLines`.
 *
 * Tries an EXACT match everywhere first. If none exists anywhere in the
 * file, retries with each line's leading/trailing whitespace trimmed
 * before comparing — LLMs very often reproduce context lines with
 * slightly different indentation or tabs-vs-spaces than what's actually
 * in the file. An exact-only comparison silently drops the hunk in that
 * case (the file just doesn't get edited), which is the #1 cause of "the
 * AI said it fixed it but the file didn't change."
 *
 * We search the full file rather than a fixed window because the AI's
 * `oldStart` line number is only as accurate as its read of the file at
 * response time — on a long file, or after any prior edit, it can drift
 * well past a ±15/±20 line window even though the content is still
 * findable. Ties (e.g. repeated boilerplate) are broken by proximity to
 * the AI's claimed position.
 */
function findHunkPosition(lines: string[], oldLines: string[], hintIdx: number): number {
  if (oldLines.length === 0) return -1;
  for (const mode of ["exact", "trimmed"] as const) {
    let best = -1;
    let bestDist = Infinity;
    for (let idx = 0; idx + oldLines.length <= lines.length; idx++) {
      let ok = true;
      for (let k = 0; k < oldLines.length; k++) {
        const a = lines[idx + k];
        const b = oldLines[k];
        if (mode === "exact" ? a !== b : a.trim() !== b.trim()) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const dist = Math.abs(idx - hintIdx);
        if (dist < bestDist) {
          bestDist = dist;
          best = idx;
        }
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

/**
 * Applies a diff to file content as a string (non-Monaco).
 * Graceful per-hunk failure: skip failing hunks, apply the rest — but
 * unlike the old version, the caller gets told exactly how many hunks
 * applied vs. failed instead of a single opaque string. A caller that
 * ignores this and just writes `.content` back regardless will silently
 * "succeed" even when zero hunks applied, which is exactly the bug this
 * type change is meant to make impossible to write by accident.
 */
export function applyDiffToContent(content: string, diff: AIDiff): DiffApplyResult | null {
  const lines = content.split("\n");
  let appliedHunks = 0;
  let failedHunks = 0;

  const sortedHunks = [...diff.hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedHunks) {
    const { oldLines, newLines } = splitHunkLines(hunk);
    const hintIdx = Math.max(0, hunk.oldStart - 1);

    if (oldLines.length === 0 && newLines.length > 0) {
      lines.splice(Math.min(hintIdx, lines.length), 0, ...newLines);
      appliedHunks++;
      continue;
    }

    const matchIdx = findHunkPosition(lines, oldLines, hintIdx);
    if (matchIdx === -1) {
      console.error(
        `[ai-diff-parser] could not apply hunk @@ -${hunk.oldStart} +${hunk.newStart} @@ ` +
        `for ${diff.filePath} — context not found anywhere in the file. Skipping.`
      );
      failedHunks++;
      continue;
    }

    lines.splice(matchIdx, oldLines.length, ...newLines);
    appliedHunks++;
  }

  if (appliedHunks === 0) return null;
  return { content: lines.join("\n"), appliedHunks, failedHunks };
}
