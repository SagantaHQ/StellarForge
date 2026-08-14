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
 */
export function extractAndParseDiffs(aiResponse: string, knownFiles?: string[]): AIDiff[] {
  // Stage 1: Extract all fenced code blocks
  const codeBlocks = [...aiResponse.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1].trim());

  // Stage 2: Filter to blocks that look like diffs
  const patchTexts = codeBlocks.filter(
    (block) =>
      /^diff --git /m.test(block) ||
      (/^--- /m.test(block) && /^\+\+\+ /m.test(block))
  );

  if (patchTexts.length === 0) return [];

  // Stage 3: Parse each block with parsePatch
  const results: AIDiff[] = [];

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

      results.push({
        filePath,
        hunks: (patch.hunks || []).map((h) => ({
          oldStart: h.oldStart,
          newStart: h.newStart,
          lines: h.lines,
        })),
        raw: text,
        isNewFile,
        isDeletedFile,
      });
    }
  }

  return results;
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
 * Returns the updated content, or null if it couldn't be applied.
 */
export function applyDiffToContent(content: string, diff: AIDiff): string | null {
  const lines = content.split("\n");
  let applied = false;

  // Process hunks in reverse order so line numbers don't shift
  const sortedHunks = [...diff.hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedHunks) {
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("-")) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith("+")) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(" ")) {
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      } else if (line.startsWith("\\")) {
        continue;
      } else {
        oldLines.push(line);
        newLines.push(line);
      }
    }

    // Find the old lines in the file
    const startIdx = Math.max(0, hunk.oldStart - 1);
    let matchIdx = -1;

    // Try exact match at expected position
    if (lines.slice(startIdx, startIdx + oldLines.length).join("\n") === oldLines.join("\n")) {
      matchIdx = startIdx;
    } else {
      // Fuzzy search ±15 lines
      for (let offset = -15; offset <= 15; offset++) {
        const idx = startIdx + offset;
        if (idx < 0 || idx + oldLines.length > lines.length) continue;
        if (lines.slice(idx, idx + oldLines.length).join("\n") === oldLines.join("\n")) {
          matchIdx = idx;
          break;
        }
      }
    }

    if (matchIdx === -1) continue;

    lines.splice(matchIdx, oldLines.length, ...newLines);
    applied = true;
  }

  return applied ? lines.join("\n") : null;
}
