// Test the intelligent parser against the user's EXACT broken example.
// The model:
//   1. Used ```diff fences for the first diff (but malformed — no closing fence)
//   2. Used custom delimiters for the second diff (but DROPPED 2 chars: <<<<<<<< instead of <<<<<<<<<<)
//
// The intelligent parser should catch BOTH diffs regardless.

import { extractAndParseDiffs } from "../src/lib/ai/ai-diff-parser";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

const knownFiles = ["src/lib.rs", "src/test.rs", "Cargo.toml"];

// =========================================================================
// Test 1: User's EXACT reported case — two diffs, both malformed
// =========================================================================
console.log("\n=== Test 1: User's exact broken example ===");
{
  const response = `The fix corrects the missing \`default_msg\` declaration and removes the trailing semicolon after \`default_msg\`, resolving both the compile error and unused variable warning.

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,4 +10,5 @@ pub fn __constructor(env: Env) {
+    let default_msg = String::from_str(&env, "Hello");  
     let default = String::from_str(&env, "Hello");  
     env.storage().instance().set(&GREETING_KEY, &default);  
     default_msg  

The build fails because \`__constructor\` references an undefined variable \`default_msg\` instead of the locally bound \`default\`. Replacing \`default_msg\` with \`default\` fixes the compilation error.

++++++++++>>>>>>>>>>
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -14,4 +14,4 @@
        let default = String::from_str(&env, "Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
-       default_msg
+       default
<<<<<<<<++++++++++`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  console.log(`  Parsed ${diffs.length} diff(s)`);
  assert(diffs.length >= 1, `finds at least 1 diff from the broken example (got ${diffs.length})`);
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath = src/lib.rs");
  assert(diffs[0]?.hunks.length >= 1, "has at least 1 hunk");
}

// =========================================================================
// Test 2: Standard ```diff fence (should still work)
// =========================================================================
console.log("\n=== Test 2: Standard ```diff fence ===");
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
  assert(diffs.length === 1, "standard ```diff fence → 1 diff");
}

// =========================================================================
// Test 3: Custom delimiters with typos (dropped chars)
// =========================================================================
console.log("\n=== Test 3: Delimiters with typos ===");
{
  // Model dropped 2 chars from end delimiter: <<<<<<<<<< → <<<<<<<<
  const response = `Fix:

++++++++++>>>>>>>>>>
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-old
+new
<<<<<<<<++++++++++`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "fuzzy delimiter matching catches typos");
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath = src/lib.rs");
}

// =========================================================================
// Test 4: No fence at all — raw diff in prose
// =========================================================================
console.log("\n=== Test 4: Raw diff in prose ===");
{
  const response = `Here's the fix:

--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-old
+new

Let me know if this works.`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "raw diff in prose → 1 diff");
}

// =========================================================================
// Test 5: diff --git format
// =========================================================================
console.log("\n=== Test 5: diff --git format ===");
{
  const response = `Here's the fix:

\`\`\`diff
diff --git a/src/lib.rs b/src/lib.rs
index 123..456 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context
-old
+new
\`\`\``;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "diff --git format → 1 diff");
}

// =========================================================================
// Test 6: Multiple diffs for same file (merge)
// =========================================================================
console.log("\n=== Test 6: Multiple diffs, same file (merge) ===");
{
  const response = `Two changes:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-old1
+new1
\`\`\`

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -20,3 +20,3 @@
-old2
+new2
\`\`\``;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "2 diffs for same file → merged into 1");
  assert(diffs[0]?.hunks.length === 2, "merged diff has 2 hunks");
}

// =========================================================================
// Test 7: Multi-file diff
// =========================================================================
console.log("\n=== Test 7: Multi-file diff ===");
{
  const response = `\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
-old
+new
\`\`\`

\`\`\`diff
--- a/Cargo.toml
+++ b/Cargo.toml
@@ -1,3 +1,3 @@
-old
+new
\`\`\``;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 2, "multi-file → 2 diffs");
}

// =========================================================================
// Test 8: Empty response
// =========================================================================
console.log("\n=== Test 8: Empty response ===");
{
  assert(extractAndParseDiffs("", knownFiles).length === 0, "empty → 0 diffs");
  assert(extractAndParseDiffs("Just prose.", knownFiles).length === 0, "prose-only → 0 diffs");
}

// =========================================================================
// Test 9: Prose-only (no code, no diff) — should NOT produce false positives
// =========================================================================
console.log("\n=== Test 9: No false positives on prose ===");
{
  const response = `I'd be happy to help. Let me think about this carefully.

The issue might be with the constructor. Let me check the types.

Actually, I'm not sure. Could you share the error output?`;

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 0, "prose-only → 0 diffs (no false positives)");
}

// =========================================================================
// Test 10: CRLF line endings
// =========================================================================
console.log("\n=== Test 10: CRLF ===");
{
  const response = "Fix:\r\n\r\n```diff\r\n--- a/src/lib.rs\r\n+++ b/src/lib.rs\r\n@@ -10,3 +10,3 @@\r\n context\r\n-old\r\n+new\r\n```\r\n";

  const diffs = extractAndParseDiffs(response, knownFiles);
  assert(diffs.length === 1, "CRLF → 1 diff");
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
