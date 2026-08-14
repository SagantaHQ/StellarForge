import { parsePatch } from "diff";
import type * as Monaco from "monaco-editor";

/**
 * AI Diff Parser — extracts GitHub-style unified diffs from AI responses
 * and converts them into Monaco editor edit operations.
 *
 * Two-stage approach:
 *   1. Extract all code blocks that look like diffs
 *   2. Parse with parsePatch() from the `diff` library
 *
 * Then convert to Monaco IIdentifiedSingleEditOperation[] for
 * undo-preserving application via model.pushEditOperations().
 */

export interface AIDiff {
  filePath: string;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
  raw: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

/**
 * Extracts and parses GitHub-style unified diffs from an AI response.
 * Handles cases where the AI wraps the diff in ```text, ```patch, or
 * misses the language tag entirely.
 *
 * Robustness notes (learned from real LLM outputs):
 *   - Normalize CRLF → LF first (some providers normalize to CRLF,
 *     which breaks the fence regex's `\n` anchors).
 *   - Tolerate missing closing fence (LLMs sometimes forget on long
 *     responses — block runs to end of string).
 *   - Merge multiple diff blocks targeting the SAME file into a single
 *     AIDiff. Without this, an LLM that emits 3 blocks for src/lib.rs
 *     produces 3 separate approval cards — confusing UX. After merge,
 *     user sees ONE card per file with all hunks grouped.
 */
export function extractAndParseDiffs(aiResponse: string, knownFiles?: string[]): AIDiff[] {
  // Normalize CRLF → LF so all downstream regex + parsePatch see consistent
  // line endings. Without this, blocks with `\r\n` won't match the fence
  // regex (which uses `\n` anchors).
  const normalized = aiResponse.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Stage 1: Extract all fenced code blocks.
  // The fence regex matches ``` or ~~~ opening, optional language tag,
  // optional trailing whitespace, then the body. The body is captured
  // lazily until:
  //   - A matching closing fence on its own line, OR
  //   - Another opening fence (LLM forgot to close previous), OR
  //   - End of string (unclosed fence — common on long responses).
  const fenceRe = /(?:^|\n)(`{3}|~{3})[a-zA-Z0-9_+-]*[ \t]*\n([\s\S]*?)(?=\n`{3}[ \t]*(\n|$)|\n~{3}[ \t]*(\n|$)|$)/g;
  const codeBlocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(normalized)) !== null) {
    codeBlocks.push(m[2].trim());
    // Skip past any closing fence so we don't re-match it as an opener
    const after = normalized.slice(m.index + m[0].length);
    const closeMatch = after.match(/^[ \t]*(`{3}|~{3})[ \t]*\n?/);
    if (closeMatch) {
      fenceRe.lastIndex += closeMatch[0].length;
    }
  }

  // Stage 2: Filter to blocks that look like diffs.
  // Either it has a `diff --git` header, OR it has both `---` and `+++`
  // headers. This filters out normal code blocks (e.g. ```rust) that don't
  // represent diffs.
  const patchTexts = codeBlocks.filter(
    (block) =>
      /^diff --git /m.test(block) ||
      (/^--- /m.test(block) && /^\+\+\+ /m.test(block))
  );

  if (patchTexts.length === 0) return [];

  // Stage 3: Parse each block with parsePatch and MERGE by filePath.
  // Multiple diff blocks targeting the same file → ONE AIDiff with all
  // hunks grouped. This is the fix for the "user wasn't prompted to
  // accept all of them" bug — they were, but as N separate cards.
  const byPath = new Map<string, AIDiff>();

  for (const text of patchTexts) {
    let patches: ReturnType<typeof parsePatch>;
    try {
      patches = parsePatch(text);
    } catch (e) {
      console.error("[ai-diff-parser] Failed to parse diff:", e);
      continue;
    }

    for (const patch of patches) {
      // Extract file path
      let filePath = patch.newFileName || patch.oldFileName || "(unknown file)";
      filePath = filePath.replace(/^[ab]\//, "");
      if (filePath === "/dev/null") {
        filePath = patch.oldFileName?.replace(/^[ab]\//, "") || "(unknown file)";
      }

      // Skip if we still have no usable path — surfacing "(unknown file)"
      // just adds noise (the agent panel can't apply it without a real path).
      if (filePath === "(unknown file)") continue;

      // Fuzzy match against known files
      if (knownFiles && knownFiles.length > 0 && !knownFiles.includes(filePath)) {
        const basename = filePath.split("/").pop();
        const match = knownFiles.find(
          (f) => f === filePath || f.endsWith("/" + basename) || f === basename
        );
        if (match) filePath = match;
      }

      const isNewFile = patch.oldFileName === "/dev/null" || patch.oldFileName === undefined;
      const isDeletedFile = patch.newFileName === "/dev/null" || patch.newFileName === undefined;
      const newHunks = (patch.hunks || []).map((h) => ({
        oldStart: h.oldStart,
        newStart: h.newStart,
        lines: h.lines,
      }));

      // Merge into existing entry for this file, or create a new one
      const existing = byPath.get(filePath);
      if (existing) {
        existing.hunks.push(...newHunks);
        existing.raw += "\n\n" + text;
        // isNewFile / isDeletedFile flags: keep the first non-default value
        // (in case the AI emits a creation + an edit in separate blocks).
        if (!existing.isNewFile && isNewFile) existing.isNewFile = true;
        if (!existing.isDeletedFile && isDeletedFile) existing.isDeletedFile = true;
      } else {
        byPath.set(filePath, {
          filePath,
          hunks: newHunks,
          raw: text,
          isNewFile,
          isDeletedFile,
        });
      }
    }
  }

  return Array.from(byPath.values());
}

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
  // numbers don't shift when later hunks are applied. (Using oldStart —
  // the line number in the ORIGINAL file — not newStart, because we're
  // matching against the original content at each step.)
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
        // Proper context line (leading space)
        const ctx = line.substring(1);
        oldLines.push(ctx);
        newLines.push(ctx);
      } else if (line === "") {
        // Empty line — LLMs often drop the leading space on blank
        // context lines. Treat as an empty context line.
        oldLines.push("");
        newLines.push("");
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" — skip
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
    // Handles the case where the file drifted slightly between AI
    // generating the diff and the user accepting it (e.g. small edit).
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
    // Safe to apply at the expected position — we're not deleting anything.
    if (matchIdx === -1 && oldLines.length === 0 && newLines.length > 0) {
      lines.splice(startIdx, 0, ...newLines);
      applied = true;
      continue;
    }

    if (matchIdx === -1) {
      // Skip this hunk — log so user/dev can see something went wrong.
      // Other hunks still apply (graceful degradation).
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
