// Comprehensive test suite for the refactored AI diff parser.
//
// Run: npx tsx scripts/test-ai-diff-parser-comprehensive.ts
//
// Validates the four-stage pipeline:
//   Stage 1: Markdown extraction (remark-parse handles all fence variants)
//   Stage 2: parsePatch() validation (content-based, not lang-tag-based)
//   Stage 3: Raw-text fallback (unfenced diffs in prose)
//   Stage 4: Merge by filePath (one AIDiff per file)

import { extractAndParseDiffs, type AIDiff } from "../src/lib/ai/ai-diff-parser";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

// =========================================================================
// Test 1: User's exact reported example — 3 diff blocks (2 for src/lib.rs,
// 1 for src/test.rs) separated by prose. Must merge into 2 AIDiff objects.
// =========================================================================
console.log("\n=== Test 1: User's reported multi-block example ===");
{
  const response = `Looking at the code, the error is caused by \`String::from_str\` which doesn't exist in Soroban SDK 27.0.5 with this signature. The correct way to create a String from a literal is using \`env.string()\`.

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -12,7 +12,7 @@ const GREETING_KEY: soroban_sdk::Symbol = symbol_short!("GREETING");
 #[contractimpl]
 impl HelloWorld {

     /// Initialize the contract with a default greeting.
     pub fn __constructor(env: Env) {
-        let default = String::from_str(&env, "Hello");
+        let default = env.string("Hello");
         env.storage().instance().set(&GREETING_KEY, &default);
     }
\`\`\`

The same fix is needed in \`get_greeting\`:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -24,7 +24,7 @@ impl HelloWorld {

     /// Read the current greeting.
     pub fn get_greeting(env: Env) -> String {
         env.storage()
             .instance()
             .get(&GREETING_KEY)
-            .unwrap_or_else(|| String::from_str(&env, "Hello"))
+            .unwrap_or_else(|| env.string("Hello"))
     }
\`\`\`

And in \`src/test.rs\`:

\`\`\`diff
--- a/src/test.rs
+++ b/src/test.rs
@@ -8,7 +8,7 @@ use soroban_sdk::testutils::Address as _;

 #[test]
 fn test_set_greeting() {
     let env = Env::default();
     let contract_id = env.register(HelloWorld, ());
     let client = HelloWorldClient::new(&env, &contract_id);

-    let new_greeting = client.set_greeting(&String::from_str(&env, "Bonjour"));
+    let new_greeting = client.set_greeting(&env.string("Bonjour"));
 }
\`\`\``;

  const diffs = extractAndParseDiffs(response, ["src/lib.rs", "src/test.rs", "Cargo.toml"]);
  console.log(`Parsed ${diffs.length} diffs (expected 2 — merged by file)`);
  assert(diffs.length === 2, "returns 2 diffs (merged by filePath)");

  const libRs = diffs.find((d) => d.filePath === "src/lib.rs");
  const testRs = diffs.find((d) => d.filePath === "src/test.rs");
  assert(!!libRs, "src/lib.rs diff present");
  assert(!!testRs, "src/test.rs diff present");
  assert(libRs?.hunks.length === 2, "src/lib.rs has 2 merged hunks (from 2 separate diff blocks)");
  assert(testRs?.hunks.length === 1, "src/test.rs has 1 hunk");

  // Verify provenance — all diffs came from fenced blocks
  assert(diffs.every((d) => d.source === "fenced"), "all diffs sourced from fenced blocks");
}

// =========================================================================
// Test 2: CRLF line endings (some providers normalize to CRLF)
// =========================================================================
console.log("\n=== Test 2: CRLF line endings ===");
{
  const response = "Here is the fix:\r\n\r\n```diff\r\n--- a/src/lib.rs\r\n+++ b/src/lib.rs\r\n@@ -1,3 +1,3 @@\r\n context\r\n-old\r\n+new\r\n```\r\n";
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "CRLF response parses to 1 diff");
  assert(diffs[0]?.hunks.length === 1, "CRLF diff has 1 hunk");
}

// =========================================================================
// Test 3: Missing closing fence (LLM forgot to close on long response)
// =========================================================================
console.log("\n=== Test 3: Missing closing fence ===");
{
  const response = `Here is the fix:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new`;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "unclosed fence parses to 1 diff");
  assert(diffs[0]?.hunks.length === 1, "unclosed fence diff has 1 hunk");
}

// =========================================================================
// Test 4: Capital 'Diff' fence (case-insensitive)
// =========================================================================
console.log("\n=== Test 4: Capital 'Diff' fence ===");
{
  const response = `\`\`\`Diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "capital Diff fence parses to 1 diff");
}

// =========================================================================
// Test 5: 'patch' fence language
// =========================================================================
console.log("\n=== Test 5: 'patch' fence language ===");
{
  const response = `\`\`\`patch
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "patch fence parses to 1 diff");
}

// =========================================================================
// Test 6: No fence language, but content is a valid diff
// (Content-based validation — ChatGPT's key recommendation)
// =========================================================================
console.log("\n=== Test 6: No fence language, content-based validation ===");
{
  const response = `Here is the fix:

\`\`\`
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "no-lang fence with valid diff content → 1 diff");
}

// =========================================================================
// Test 7: Non-diff code block (e.g. ```rust with normal code)
// MUST NOT be parsed as a diff — false positives would silently corrupt
// user files on Accept.
// =========================================================================
console.log("\n=== Test 7: Non-diff code block rejected ===");
{
  const response = `Here's some code:

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/main.rs"]);
  assert(diffs.length === 0, "non-diff rust block → 0 diffs (parsePatch validation rejects)");
}

// =========================================================================
// Test 8: Mixed — non-diff block + real diff (only the real one should parse)
// =========================================================================
console.log("\n=== Test 8: Mixed diff + non-diff blocks ===");
{
  const response = `Here's some code:

\`\`\`rust
fn main() {}
\`\`\`

And here's the fix:

\`\`\`diff
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
+    println!("hello");
 }
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/main.rs"]);
  assert(diffs.length === 1, "mixed response → 1 diff (only the real one)");
  assert(diffs[0]?.filePath === "src/main.rs", "diff targets the correct file");
}

// =========================================================================
// Test 9: Empty response — no false positives
// =========================================================================
console.log("\n=== Test 9: Empty response ===");
{
  assert(extractAndParseDiffs("", ["src/lib.rs"]).length === 0, "empty string → 0 diffs");
  assert(extractAndParseDiffs("Hello, how can I help?", ["src/lib.rs"]).length === 0, "no code blocks → 0 diffs");
  assert(extractAndParseDiffs("Just prose, no code at all.", []).length === 0, "prose-only → 0 diffs");
}

// =========================================================================
// Test 10: Raw-text fallback — LLM didn't use a code fence
// (Scan prose for `diff --git` and `--- /+++` markers)
// =========================================================================
console.log("\n=== Test 10: Raw-text fallback (no code fence) ===");
{
  const response = `Here is the patch:

diff --git a/src/lib.rs b/src/lib.rs
index 1234567..abcdefg 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn hello() {
-    let x = 5
+    let x = 5;
 }

Please review.`;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "raw-text fallback finds the unfenced diff");
  assert(diffs[0]?.filePath === "src/lib.rs", "raw-text diff targets correct file");
  assert(diffs[0]?.source === "raw", "raw-text diff has source='raw'");
  assert(diffs[0]?.hunks.length === 1, "raw-text diff has 1 hunk");
}

// =========================================================================
// Test 11: Raw-text fallback with `--- /+++` but no `diff --git` header
// =========================================================================
console.log("\n=== Test 11: Raw-text fallback without diff --git header ===");
{
  const response = `Here's the fix:

--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new

Let me know if this works.`;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "raw-text fallback (no diff --git) finds the diff");
  assert(diffs[0]?.source === "raw", "raw-text diff has source='raw'");
}

// =========================================================================
// Test 12: Raw-text fallback is SKIPPED when a fenced diff exists
// (avoid duplicate detection)
// =========================================================================
console.log("\n=== Test 12: Raw-text fallback skipped when fenced diff exists ===");
{
  const response = `Here is a fenced diff:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\`

And some raw text that looks diff-like:

--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
 context2
-old2
+new2`;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  // Only the fenced diff should be detected (the raw fallback doesn't run)
  assert(diffs.length === 1, "raw-text fallback skipped when fenced diff exists");
  assert(diffs[0]?.hunks.length === 1, "only fenced diff's hunk is present");
  assert(diffs[0]?.source === "fenced", "diff is sourced from fenced");
}

// =========================================================================
// Test 13: Multiple diff --git sections in a single fenced block
// (LLM puts all file changes in one big diff block)
// =========================================================================
console.log("\n=== Test 13: Multi-file diff in single fence ===");
{
  const response = `Here are all the changes:

\`\`\`diff
diff --git a/src/lib.rs b/src/lib.rs
index 123..456 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn hello() {
-    let x = 5
+    let x = 5;
 }
diff --git a/src/test.rs b/src/test.rs
index 789..abc 100644
--- a/src/test.rs
+++ b/src/test.rs
@@ -1,3 +1,3 @@
 #[test]
 fn test_hello() {
-    assert!(x == 5)
+    assert_eq!(x, 5);
 }
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs", "src/test.rs"]);
  assert(diffs.length === 2, "multi-file diff in one fence → 2 AIDiff objects");
  assert(!!diffs.find((d) => d.filePath === "src/lib.rs"), "src/lib.rs diff present");
  assert(!!diffs.find((d) => d.filePath === "src/test.rs"), "src/test.rs diff present");
}

// =========================================================================
// Test 14: Tilde fences (~~~diff ... ~~~)
// =========================================================================
console.log("\n=== Test 14: Tilde fences ===");
{
  const response = `~~~diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
~~~`;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "tilde fence parses to 1 diff");
}

// =========================================================================
// Test 15: File creation (old file = /dev/null) — AIDiff.isNewFile = true
// =========================================================================
console.log("\n=== Test 15: New file creation ===");
{
  const response = `\`\`\`diff
--- /dev/null
+++ b/src/new_file.rs
@@ -0,0 +1,3 @@
+pub fn new_function() -> u32 {
+    42
+}
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/new_file.rs"]);
  assert(diffs.length === 1, "file creation diff parses");
  assert(diffs[0]?.isNewFile === true, "isNewFile=true for /dev/null → b/path");
  assert(diffs[0]?.filePath === "src/new_file.rs", "file path resolved correctly");
}

// =========================================================================
// Test 16: Fuzzy path matching — LLM emits wrong path, known files resolve it
// =========================================================================
console.log("\n=== Test 16: Fuzzy path matching ===");
{
  const response = `\`\`\`diff
--- a/lib.rs
+++ b/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  // LLM said "lib.rs" but project file is "src/lib.rs"
  const diffs = extractAndParseDiffs(response, ["src/lib.rs", "Cargo.toml"]);
  assert(diffs.length === 1, "fuzzy match resolves 'lib.rs' to 'src/lib.rs'");
  assert(diffs[0]?.filePath === "src/lib.rs", "filePath updated to canonical project path");
}

// =========================================================================
// Test 17: Trailing whitespace after fence language tag (```diff )
// =========================================================================
console.log("\n=== Test 17: Trailing whitespace after fence tag ===");
{
  const response = `\`\`\`diff   
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length === 1, "trailing whitespace after fence tag handled");
}

// =========================================================================
// Test 18: Quoted file paths in diff headers
// (rare but parsePatch handles them — verifies our path extraction)
// =========================================================================
console.log("\n=== Test 18: Quoted file paths ===");
{
  // Note: parsePatch handles quoted paths; we just verify our resolver strips quotes
  const response = `\`\`\`diff
--- "a/src/lib.rs"
+++ "b/src/lib.rs"
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``;
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  assert(diffs.length >= 1, "quoted paths parse");
  // parsePatch may keep quotes in the path; our resolver should strip them
  if (diffs.length > 0) {
    assert(!diffs[0].filePath.startsWith('"'), "quotes stripped from file path");
  }
}

// =========================================================================
// Test 19: Performance — large response with many code blocks
// (Smoke test: parser should complete in <100ms for ~5KB response)
// =========================================================================
console.log("\n=== Test 19: Performance on large response ===");
{
  // Build a 5KB response with 10 rust code blocks + 1 real diff
  const blocks: string[] = [];
  for (let i = 0; i < 10; i++) {
    blocks.push(`\`\`\`rust
fn function_${i}() -> u32 {
    ${i}
}
\`\`\``);
  }
  blocks.push(`\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 context
-old
+new
\`\`\``);
  const response = blocks.join("\n\n");
  const start = Date.now();
  const diffs = extractAndParseDiffs(response, ["src/lib.rs"]);
  const elapsed = Date.now() - start;
  assert(diffs.length === 1, "only the real diff is parsed");
  assert(elapsed < 500, `parser completes in <500ms (got ${elapsed}ms)`);
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
