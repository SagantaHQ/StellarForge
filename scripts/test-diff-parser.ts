import { parseDiffFromResponse } from "../src/lib/ai/context-assembler";

// =========================================================================
// Test 1: Simple single-diff response (original case).
// =========================================================================
const response = `Here is the fix:

\`\`\`diff
--- src/lib.rs
+++ src/lib.rs
@@ -1,5 +1,5 @@
 pub fn hello() {
-    let x = 5
+    let x = 5;
 }
\`\`\`

This adds the missing semicolon.`;

const knownFiles = ["src/lib.rs", "Cargo.toml"];

console.log("=== Test 1: parseDiffFromResponse (simple case) ===");
console.log("Response:", response);
console.log("");

const diffs = parseDiffFromResponse(response, knownFiles);
console.log("Parsed diffs:", diffs.length);

for (const d of diffs) {
  console.log("  filePath:", d.filePath);
  console.log("  hunks:", d.hunks.length);
  console.log("  lines in first hunk:", d.hunks[0]?.lines.length);
  console.log("  raw (first 200 chars):", d.raw.substring(0, 200));
}

if (diffs.length === 0) {
  console.log("\n⚠️ NO DIFFS PARSED — this is the bug!");
  console.log("The diff block pattern might not match, or the file path patterns don't match.");
  process.exit(1);
} else if (diffs[0].filePath === "(unknown file)") {
  console.log("\n⚠️ FILE PATH IS '(unknown file)' — parser couldn't extract the path!");
  process.exit(1);
} else {
  console.log("\n✓ Diff parsed correctly with file path:", diffs[0].filePath);
}

// =========================================================================
// Test 2: Multi-block response — multiple diff blocks separated by prose,
// some targeting the SAME file (must merge into ONE AIDiff with all hunks).
// =========================================================================
console.log("\n=== Test 2: Multi-block response with file merge ===");
const multiResponse = `Here are the fixes:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-    let x = 5
+    let x = 5;
\`\`\`

And another fix in the same file:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -20,3 +20,3 @@
-    let y = 10
+    let y = 10;
\`\`\`

And a fix in another file:

\`\`\`diff
--- a/src/test.rs
+++ b/src/test.rs
@@ -5,3 +5,3 @@
-    assert!(x == 5)
+    assert_eq!(x, 5);
\`\`\``;

const multiDiffs = parseDiffFromResponse(multiResponse, ["src/lib.rs", "src/test.rs"]);
console.log(`Parsed ${multiDiffs.length} diffs (expected 2 — merged by file)`);

const libRs = multiDiffs.find((d) => d.filePath === "src/lib.rs");
const testRs = multiDiffs.find((d) => d.filePath === "src/test.rs");

if (multiDiffs.length !== 2) {
  console.log(`⚠️ Expected 2 diffs, got ${multiDiffs.length}`);
  process.exit(1);
} else if (!libRs || libRs.hunks.length !== 2) {
  console.log(`⚠️ src/lib.rs should have 2 merged hunks, got ${libRs?.hunks.length ?? 0}`);
  process.exit(1);
} else if (!testRs || testRs.hunks.length !== 1) {
  console.log(`⚠️ src/test.rs should have 1 hunk, got ${testRs?.hunks.length ?? 0}`);
  process.exit(1);
} else {
  console.log("✓ Multi-block response correctly merged into 2 diffs (1 per file)");
}

// =========================================================================
// Test 3: CRLF line endings (some providers normalize to CRLF).
// =========================================================================
console.log("\n=== Test 3: CRLF line endings ===");
const crlfDiffs = parseDiffFromResponse(response.replace(/\n/g, "\r\n"), knownFiles);
if (crlfDiffs.length !== 1) {
  console.log(`⚠️ CRLF: expected 1 diff, got ${crlfDiffs.length}`);
  process.exit(1);
} else {
  console.log("✓ CRLF line endings handled correctly");
}

// =========================================================================
// Test 4: Missing closing fence (LLM forgot to close).
// =========================================================================
console.log("\n=== Test 4: Missing closing fence ===");
const unclosedResponse = `Here is the fix:

\`\`\`diff
--- src/lib.rs
+++ src/lib.rs
@@ -1,5 +1,5 @@
 pub fn hello() {
-    let x = 5
+    let x = 5;
 }`;
const unclosedDiffs = parseDiffFromResponse(unclosedResponse, knownFiles);
if (unclosedDiffs.length !== 1) {
  console.log(`⚠️ Unclosed fence: expected 1 diff, got ${unclosedDiffs.length}`);
  process.exit(1);
} else {
  console.log("✓ Missing closing fence handled correctly");
}

// =========================================================================
// Test 5: Non-diff code block (must NOT be parsed as a diff).
// =========================================================================
console.log("\n=== Test 5: Non-diff code block ===");
const mixedResponse = `Here's some code:

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\`

And here's a diff:

\`\`\`diff
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
+    println!("hello");
 }
\`\`\``;
const mixedDiffs = parseDiffFromResponse(mixedResponse, ["src/main.rs"]);
if (mixedDiffs.length !== 1) {
  console.log(`⚠️ Non-diff block: expected 1 diff, got ${mixedDiffs.length}`);
  process.exit(1);
} else {
  console.log("✓ Non-diff code block correctly ignored");
}

console.log("\n=== All tests passed ===");
