import { parseDiffFromResponse } from "../src/lib/ai/context-assembler";

// Test 1: The exact response the user reported (with ```diff block)
const response1 = "The errors occur because `src/lib.rs` is missing imports.\n\n" +
"```diff\n" +
"--- a/src/lib.rs\n" +
"+++ b/src/lib.rs\n" +
"@@ -1,30 +1,32 @@\n" +
" #![no_std]\n" +
"+use soroban_sdk::{contract, contractimpl, Env, String, symbol_short};\n" +
" \n" +
" #[contract]\n" +
" pub struct HelloWorld;\n" +
"+\n" +
"+const GREETING_KEY: soroban_sdk::Symbol = symbol_short!(\"GREETING\");\n" +
" \n" +
" \n" +
" #[contractimpl]\n" +
" impl HelloWorld {\n" +
"-a \n" +
"     /// Initialize the contract with a default greeting.\n" +
"     pub fn __constructor(env: Env) {\n" +
"         let default = String::from_str(&env, \"Hello\");\n" +
"         env.storage().instance().set(&GREETING_KEY, &default);\n" +
"     }\n" +
" \n" +
"     /// Set a new greeting. Returns the new greeting.\n" +
"     pub fn set_greeting(env: Env, greeting: String) -> String {\n" +
"         env.storage().instance().set(&GREETING_KEY, &greeting);\n" +
"         greeting\n" +
"     }\n" +
" \n" +
"     /// Read the current greeting.\n" +
"     pub fn get_greeting(env: Env) -> String {\n" +
"         env.storage()\n" +
"             .instance()\n" +
"             .get(&GREETING_KEY)\n" +
"             .unwrap_or_else(|| String::from_str(&env, \"Hello\"))\n" +
"     }\n" +
" \n" +
"     /// Returns a personalized greeting addressed to `name`.\n" +
"     pub fn greet(env: Env, name: String) -> String {\n" +
"         let greeting = Self::get_greeting(env.clone());\n" +
"         if name.is_empty() {\n" +
"             return greeting;\n" +
"         }\n" +
"         greeting\n" +
"     }\n" +
" }\n" +
"```";

const knownFiles = ["src/lib.rs", "Cargo.toml"];

console.log("=== Test 1: Full diff with backtick fences ===");
const diffs1 = parseDiffFromResponse(response1, knownFiles);
console.log("Parsed diffs:", diffs1.length);
if (diffs1.length > 0) {
  console.log("  filePath:", diffs1[0].filePath);
  console.log("  hunks:", diffs1[0].hunks.length);
  if (diffs1[0].hunks.length > 0) {
    console.log("  hunk lines:", diffs1[0].hunks[0].lines.length);
  }
} else {
  console.log("  ⚠️ NO DIFFS PARSED — investigating...");
  // Check the regex
  const block = /```diff\n([\s\S]*?)```/g;
  let m;
  while ((m = block.exec(response1)) !== null) {
    console.log("  Found diff block, length:", m[1].length);
    console.log("  First 80 chars:", m[1].substring(0, 80));
    // Check hunk pattern — note the \n after @@
    const hunkRe = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\n([\s\S]*?)(?=\n@@|\n```|$)/g;
    let h;
    let hunkCount = 0;
    while ((h = hunkRe.exec(m[1])) !== null) {
      hunkCount++;
      console.log(`  Hunk ${hunkCount}: old=${h[1]} new=${h[2]} lines=${h[3].split("\n").filter(l=>l.length>0).length}`);
    }
    if (hunkCount === 0) {
      console.log("  ⚠️ NO HUNKS PARSED!");
      // Check if the issue is the \n after @@
      const hunkLine = m[1].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (hunkLine) {
        console.log("  Hunk line found:", hunkLine[0].substring(0, 60));
        console.log("  After @@:", JSON.stringify(hunkLine[3]?.substring(0, 20)));
      }
    }
  }
}

// Test 2: Two separate diff blocks (the second response)
console.log("\n=== Test 2: Second diff block (smaller) ===");
const response2 = "The error is a mismatched types error.\n\n" +
"```diff\n" +
"--- a/src/lib.rs\n" +
"+++ b/src/lib.rs\n" +
"@@ -17,7 +17,8 @@ impl HelloWorld {\n" +
"     /// Set a new greeting. Returns the new greeting.\n" +
"     pub fn set_greeting(env: Env, greeting: String) -> String {\n" +
"         env.storage().instance().set(&GREETING_KEY, &greeting);\n" +
"+        greeting\n" +
"     }\n" +
" \n" +
"     /// Read the current greeting.\n" +
"```";

const diffs2 = parseDiffFromResponse(response2, knownFiles);
console.log("Parsed diffs:", diffs2.length);
if (diffs2.length > 0) {
  console.log("  filePath:", diffs2[0].filePath);
  console.log("  hunks:", diffs2[0].hunks.length);
}
