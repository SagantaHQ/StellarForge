// Test the hasCodeButNoDiff helper + the new "ask agent to format as diff"
// UI affordance. Built around the user's reported case where the agent
// produced a long prose-only response without a ```diff block.

import { parseDiffFromResponse } from "../src/lib/ai/context-assembler";

// ─── Inline copy of hasCodeButNoDiff (must mirror the production impl) ──
function hasCodeButNoDiff(content: string): boolean {
  const hasFence = /(?:^|\n)(?:`{3}|~{3})[a-zA-Z0-9_+-]*[ \t]*\n[\s\S]/.test(content);
  if (!hasFence) return false;
  const diffs = parseDiffFromResponse(content, []);
  return diffs.length === 0;
}

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.log(`  ✗ FAIL: ${msg}`); }
}

// =========================================================================
// Test 1: User's exact reported case — long prose + ```rust block, NO diff
// =========================================================================
console.log("\n=== Test 1: Prose + ```rust block, no diff ===");
{
  // This is the SHAPE of the user's reported response — analysis + code
  // shown in a ```rust block, but no ```diff block ever emitted.
  const response = `Looking at the provided \`src/lib.rs\`:

\`\`\`rust
#![no_std]

use soroban_sdk::{contract, contractimpl, Env, String};

const GREETING_KEY: &str = "Greeting";

#[contract]
pub struct HelloWorld;

#[contractimpl]
impl HelloWorld {
    pub fn __constructor(env: Env, default_msg: String) {
        env.storage().instance().set(&GREETING_KEY, &default_msg);
        default_msg
    }
}
\`\`\`

Potential type mismatches:

1. In \`__constructor\`, the \`set\` method might expect...
2. In \`greet\` function: \`env.clone()\`...
3. The error could be in \`get_greeting\`...

Given that I cannot run the compiler, I need to make an educated guess.`;

  assert(hasCodeButNoDiff(response), "prose + ```rust block + no diff → true");
  assert(parseDiffFromResponse(response, []).length === 0, "parser finds 0 diffs");
}

// =========================================================================
// Test 2: Response with a proper diff block → hasCodeButNoDiff = false
// =========================================================================
console.log("\n=== Test 2: Proper diff block ===");
{
  const response = `The error is caused by String::from_str not existing. Fix:

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-        let default = String::from_str(&env, "Hello");
+        let default = env.string("Hello");
\`\`\``;

  assert(!hasCodeButNoDiff(response), "proper diff block → false");
  assert(parseDiffFromResponse(response, ["src/lib.rs"]).length === 1, "parser finds 1 diff");
}

// =========================================================================
// Test 3: Pure prose (no code blocks at all) → hasCodeButNoDiff = false
// (Don't show the affordance — there's nothing to convert to a diff)
// =========================================================================
console.log("\n=== Test 3: Pure prose, no code blocks ===");
{
  const response = `I'd be happy to help with that. Could you tell me which file you'd like me to look at?`;

  assert(!hasCodeButNoDiff(response), "pure prose → false (no affordance — nothing to convert)");
}

// =========================================================================
// Test 4: Empty response → hasCodeButNoDiff = false
// =========================================================================
console.log("\n=== Test 4: Empty response ===");
{
  assert(!hasCodeButNoDiff(""), "empty string → false");
  assert(!hasCodeButNoDiff("   "), "whitespace-only → false");
}

// =========================================================================
// Test 5: Code block with no language tag → still detected as code
// (parsePatch validates content, not the language tag)
// =========================================================================
console.log("\n=== Test 5: Untagged code block with diff content ===");
{
  const response = `Here's the fix:

\`\`\`
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,3 @@
-        let default = String::from_str(&env, "Hello");
+        let default = env.string("Hello");
\`\`\``;

  // Should NOT trigger hasCodeButNoDiff — parsePatch's content-based
  // validation accepts this as a valid diff (no fence lang, but content
  // has --- /+++ markers).
  assert(!hasCodeButNoDiff(response), "untagged diff block → false (content-based validation accepts it)");
}

// =========================================================================
// Test 6: Multiple ```rust blocks but no ```diff → true
// =========================================================================
console.log("\n=== Test 6: Multiple ```rust blocks, no diff ===");
{
  const response = `Here's the original code:

\`\`\`rust
pub fn hello() {}
\`\`\`

And here's my proposed new version:

\`\`\`rust
pub fn hello() -> String {
    String::from_str(&env, "Hello")
}
\`\`\`

Let me know what you think!`;

  assert(hasCodeButNoDiff(response), "multiple ```rust blocks + no diff → true");
}

// =========================================================================
// Test 7: Long analysis that ends without producing a diff
// (Reproduces the user's exact failure mode — agent rambles forever)
// =========================================================================
console.log("\n=== Test 7: Long analysis, ends without diff ===");
{
  const response = `Let me analyze this carefully.

First, I need to identify the file and line causing the error. The error output doesn't show the file path and line number, but typically the build error would indicate something like \`src/lib.rs:xx:yy\`.

Looking at the code, I see several potential issues:

1. The constructor returns a String but might be expected to return ()
2. The env.clone() call might not work in this SDK version
3. The String::from_str signature might have changed

Let me think about this more carefully...

Actually, I'm not sure what the exact error is. Without running the compiler, I can only guess.`;

  assert(!hasCodeButNoDiff(response), "long analysis without any code block → false (no code block to convert)");

  // But if the same analysis includes a code block...
  const responseWithCode = response + `

\`\`\`rust
pub fn __constructor(env: Env, default_msg: String) {
    env.storage().instance().set(&GREETING_KEY, &default_msg);
}
\`\`\``;

  assert(hasCodeButNoDiff(responseWithCode), "long analysis + ```rust block + no diff → true");
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
