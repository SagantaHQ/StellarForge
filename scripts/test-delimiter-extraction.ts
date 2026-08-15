// Test the intelligent parser — covers all formats including broken delimiters.
import { extractAndParseDiffs } from "../src/lib/ai/ai-diff-parser";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

const knownFiles = ["src/lib.rs", "src/test.rs", "Cargo.toml"];
const DSTART = "++++++++++>>>>>>>>>>";
const DEND = "<<<<<<<<<<++++++++++";

// Test 1: Custom delimiters (exact)
console.log("\n=== Test 1: Custom delimiters ===");
{
  const r = `Fix:\n${DSTART}\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n${DEND}`;
  assert(extractAndParseDiffs(r, knownFiles).length === 1, "exact delimiters → 1 diff");
}

// Test 2: Custom delimiters with typos (dropped chars)
console.log("\n=== Test 2: Delimiters with typos ===");
{
  const r = `Fix:\n++++++++++>>>>>>>>>>\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n<<<<<<<<++++++++++`;
  const d = extractAndParseDiffs(r, knownFiles);
  assert(d.length === 1, "fuzzy delimiter (dropped 2 chars) → 1 diff");
  assert(d[0]?.filePath === "src/lib.rs", "filePath correct");
}

// Test 3: Standard ```diff fence
console.log("\n=== Test 3: ```diff fence ===");
{
  const r = "Fix:\n```diff\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n```";
  assert(extractAndParseDiffs(r, knownFiles).length === 1, "```diff → 1 diff");
}

// Test 4: Raw diff in prose (no wrapping)
console.log("\n=== Test 4: Raw diff ===");
{
  const r = "Fix:\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n context\n-old\n+new\nDone.";
  assert(extractAndParseDiffs(r, knownFiles).length === 1, "raw diff → 1 diff");
}

// Test 5: Multi-file
console.log("\n=== Test 5: Multi-file ===");
{
  const r = "```diff\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,1 +1,1 @@\n-old\n+new\n```\n```diff\n--- a/Cargo.toml\n+++ b/Cargo.toml\n@@ -1,1 +1,1 @@\n-old\n+new\n```";
  assert(extractAndParseDiffs(r, knownFiles).length === 2, "multi-file → 2 diffs");
}

// Test 6: Same file merge
console.log("\n=== Test 6: Same file merge ===");
{
  const r = "```diff\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -10,1 +10,1 @@\n-old1\n+new1\n```\n```diff\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -20,1 +20,1 @@\n-old2\n+new2\n```";
  const d = extractAndParseDiffs(r, knownFiles);
  assert(d.length === 1, "2 diffs same file → merged");
  assert(d[0]?.hunks.length === 2, "merged has 2 hunks");
}

// Test 7: CRLF
console.log("\n=== Test 7: CRLF ===");
{
  const r = "Fix:\r\n```diff\r\n--- a/src/lib.rs\r\n+++ b/src/lib.rs\r\n@@ -1,3 +1,3 @@\r\n context\r\n-old\r\n+new\r\n```";
  assert(extractAndParseDiffs(r, knownFiles).length === 1, "CRLF → 1 diff");
}

// Test 8: Empty / prose-only
console.log("\n=== Test 8: Empty/prose ===");
{
  assert(extractAndParseDiffs("", knownFiles).length === 0, "empty → 0");
  assert(extractAndParseDiffs("Just prose.", knownFiles).length === 0, "prose → 0");
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
