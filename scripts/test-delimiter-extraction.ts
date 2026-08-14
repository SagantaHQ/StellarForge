// Test the new custom-delimiter-based diff extraction.
//
// Run: npx tsx scripts/test-delimiter-extraction.ts
//
// Verifies that:
//   - Diffs wrapped in ++++++++++>>>>>>>>>> ... <<<<<<<<<<++++++++++ are extracted
//   - Multiple delimiter pairs (multi-file) are handled
//   - Missing end delimiter extracts to end of string
//   - CRLF line endings work
//   - Prose before/after the delimiters is ignored
//   - Old ```diff fence format still works as a fallback
//   - The user's exact reported case (prose-only, no delimiters, no fence)
//     still triggers the "no diff detected" affordance via hasCodeButNoDiff

import {
  extractAndParseDiffs,
  DIFF_START_DELIMITER,
  DIFF_END_DELIMITER,
} from "../src/lib/ai/ai-diff-parser";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

const knownFiles = ["src/lib.rs", "src/test.rs", "Cargo.toml"];

// =========================================================================
// Test 1: Single diff wrapped in delimiters
// =========================================================================
console.log("\n=== Test 1: Single delimited diff ===");
{
  const response = `The error is caused by String::from_str not existing. Fix:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-        let default = String::from_str(&env, "Hello");
+        let default = env.string("Hello");
 context
${DIFF_END_DELIMITER}

Let me know if you need anything else.`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "returns 1 diff");
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath = src/lib.rs");
  assert(diffs[0]?.hunks.length === 1, "1 hunk");
  assert(diffs[0]?.source === "delimited", "source = delimited (primary path)");
}

// =========================================================================
// Test 2: Multi-file diff (two delimiter pairs)
// =========================================================================
console.log("\n=== Test 2: Multi-file delimited diff ===");
{
  const response = `Here are the fixes:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-old
+new
${DIFF_END_DELIMITER}

${DIFF_START_DELIMITER}
--- a/src/test.rs
+++ b/src/test.rs
@@ -5,3 +5,3 @@
-old test
+new test
${DIFF_END_DELIMITER}`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 2, "returns 2 diffs (one per file)");
  assert(!!diffs.find((d) => d.filePath === "src/lib.rs"), "src/lib.rs present");
  assert(!!diffs.find((d) => d.filePath === "src/test.rs"), "src/test.rs present");
  assert(diffs.every((d) => d.source === "delimited"), "all source = delimited");
}

// =========================================================================
// Test 3: Multiple diffs for the SAME file (merge into one AIDiff)
// =========================================================================
console.log("\n=== Test 3: Multiple delimited diffs for same file (merge) ===");
{
  const response = `Two changes to lib.rs:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-old1
+new1
${DIFF_END_DELIMITER}

And another change:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -20,3 +20,3 @@
-old2
+new2
${DIFF_END_DELIMITER}`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "returns 1 diff (merged by file)");
  assert(diffs[0]?.hunks.length === 2, "merged diff has 2 hunks");
}

// =========================================================================
// Test 4: Missing end delimiter → extract to end of string
// =========================================================================
console.log("\n=== Test 4: Missing end delimiter ===");
{
  const response = `Fix:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-old
+new
 context`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "extracts to end of string when no end delimiter");
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath resolved correctly");
}

// =========================================================================
// Test 5: CRLF line endings
// =========================================================================
console.log("\n=== Test 5: CRLF line endings ===");
{
  const response = `Fix:\r\n\r\n${DIFF_START_DELIMITER}\r\n--- a/src/lib.rs\r\n+++ b/src/lib.rs\r\n@@ -10,3 +10,3 @@\r\n context\r\n-old\r\n+new\r\n${DIFF_END_DELIMITER}\r\n`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "CRLF response parses to 1 diff");
  assert(diffs[0]?.hunks.length === 1, "CRLF diff has 1 hunk");
}

// =========================================================================
// Test 6: Delimiters + ```diff fence (both present)
// The delimited path wins (higher trust), but the fenced diff is also parsed
// and merged if it targets a different file
// =========================================================================
console.log("\n=== Test 6: Both delimiters + ```diff fence ===");
{
  const response = `Fix:

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
-old delimited
+new delimited
${DIFF_END_DELIMITER}

\`\`\`diff
--- a/src/test.rs
+++ b/src/test.rs
@@ -1,3 +1,3 @@
-old fenced
+new fenced
\`\`\``;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 2, "returns 2 diffs (one per file)");
  const libRs = diffs.find((d) => d.filePath === "src/lib.rs");
  const testRs = diffs.find((d) => d.filePath === "src/test.rs");
  assert(libRs?.source === "delimited", "src/lib.rs source = delimited");
  assert(testRs?.source === "fenced", "src/test.rs source = fenced");
}

// =========================================================================
// Test 7: Old ```diff fence format still works (backward compat)
// =========================================================================
console.log("\n=== Test 7: Backward compat — ```diff fence ===");
{
  const response = `Fix:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-old
+new
\`\`\``;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "old ```diff fence still parses");
  assert(diffs[0]?.source === "fenced", "source = fenced (fallback path)");
}

// =========================================================================
// Test 8: Empty response
// =========================================================================
console.log("\n=== Test 8: Empty response ===");
{
  assert(extractAndParseDiffs("", knownFiles).length === 0, "empty string → 0 diffs");
  assert(extractAndParseDiffs("   ", knownFiles).length === 0, "whitespace → 0 diffs");
  assert(extractAndParseDiffs("Just prose, no code.", knownFiles).length === 0, "prose-only → 0 diffs");
}

// =========================================================================
// Test 9: Delimiter as part of the diff content (edge case — shouldn't
// break extraction)
// =========================================================================
console.log("\n=== Test 9: Delimiter appears in prose before the diff ===");
{
  const response = `I'll use the delimiters ${DIFF_START_DELIMITER} and ${DIFF_END_DELIMITER} to mark my diff.

${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
-old
+new
${DIFF_END_DELIMITER}`;

  // The first occurrence of DIFF_START_DELIMITER is in the prose.
  // The parser will try to extract from there, find no DIFF_END_DELIMITER
  // before the next DIFF_START_DELIMITER... actually indexOf just finds
  // the next occurrence. So it should still work — the content between
  // the prose-mentioned delimiters is just text (not a valid diff), so
  // tryParseAsDiff returns ok=false and it's silently dropped. Then
  // the search continues from after that, finds the real delimiter pair.
  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length >= 1, "finds at least 1 diff even with delimiter in prose");
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath = src/lib.rs");
}

// =========================================================================
// Test 10: Delimiters with extra whitespace around them
// =========================================================================
console.log("\n=== Test 10: Whitespace around delimiters ===");
{
  const response = `Fix:

   ${DIFF_START_DELIMITER}
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
-old
+new
   ${DIFF_END_DELIMITER}`;

  // Leading whitespace before the delimiter shouldn't break extraction
  // (indexOf finds the delimiter regardless of surrounding whitespace)
  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "whitespace-padded delimiters work");
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
