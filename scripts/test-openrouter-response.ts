// Test parser against real OpenRouter LLM response
import { extractAndParseDiffs, applyDiffToContent } from "../src/lib/ai/ai-diff-parser";

// The EXACT response from OpenRouter / nvidia/nemotron-3-ultra-550b-a55b:free
const responseText = `The error shows that \`String::from_str\` was removed in soroban-sdk 27.0.5. The fix is to replace both occurrences with \`env.string("Hello")\`.

\`\`\`diff
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -11,8 +11,8 @@ impl HelloWorld {
     /// Initialize the contract with a default greeting.
     pub fn __constructor(env: Env) {
-        let default = String::from_str(&env, "Hello");
+        let default = env.string("Hello");
         env.storage().instance().set(&GREETING_KEY, &default);
     }
 
     /// Read the current greeting.
     pub fn get_greeting(env: Env) -> String {
         env.storage()
             .instance()
             .get(&GREETING_KEY)
-            .unwrap_or_else(|| String::from_str(&env, "Hello"))
+            .unwrap_or_else(|| env.string("Hello"))
     }
 }
\`\`\``;

const fileContent = `#![no_std]

use soroban_sdk::{contract, contractimpl, Env, String};

const GREETING_KEY: &str = "Greeting";

#[contract]
pub struct HelloWorld;

#[contractimpl]
impl HelloWorld {
    /// Initialize the contract with a default greeting.
    pub fn __constructor(env: Env) {
        let default = String::from_str(&env, "Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
    }

    /// Read the current greeting.
    pub fn get_greeting(env: Env) -> String {
        env.storage()
            .instance()
            .get(&GREETING_KEY)
            .unwrap_or_else(|| String::from_str(&env, "Hello"))
    }
}`;

console.log("=== Testing parser against real OpenRouter response ===");
console.log("Response length:", responseText.length);
console.log("");

const knownFiles = ["src/lib.rs", "Cargo.toml"];
const diffs = extractAndParseDiffs(responseText, knownFiles);

console.log(`Parsed ${diffs.length} diff(s)`);
for (const d of diffs) {
  console.log(`  filePath: ${d.filePath}`);
  console.log(`  hunks: ${d.hunks.length}`);
  console.log(`  source: ${d.source}`);
  for (const h of d.hunks) {
    console.log(`    @@ -${h.oldStart} +${h.newStart} @@ (${h.lines.length} lines)`);
    for (const line of h.lines) {
      console.log(`      ${line}`);
    }
  }
}

if (diffs.length > 0) {
  console.log("");
  console.log("=== Testing applyDiffToContent ===");
  const patched = applyDiffToContent(fileContent, diffs[0]);
  if (patched) {
    // applyDiffToContent returns { content, appliedHunks, failedHunks } or null
    const patchedContent = typeof patched === "string" ? patched : (patched as { content?: string }).content ?? "";
    console.log("✅ Diff applied successfully!");
    console.log("");
    console.log("=== PATCHED FILE ===");
    console.log(patchedContent);
    console.log("=== END ===");

    // Verify the fix was applied
    const hasFromStr = patchedContent.includes("String::from_str");
    const hasEnvString = patchedContent.includes('env.string("Hello")');
    console.log("");
    console.log("Verification:");
    console.log(`  String::from_str removed: ${!hasFromStr ? "✅" : "❌ STILL PRESENT"}`);
    console.log(`  env.string("Hello") added: ${hasEnvString ? "✅" : "❌ MISSING"}`);
  } else {
    console.log("❌ applyDiffToContent returned null — diff didn't apply");
  }
} else {
  console.log("");
  console.log("❌ PARSER FAILED — 0 diffs found!");
}
