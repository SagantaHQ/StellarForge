// Test the user's EXACT diff that failed to show the Accept button
import { extractAndParseDiffs } from "../src/lib/ai/ai-diff-parser";
import { parsePatch } from "diff";

const knownFiles = ["src/lib.rs", "src/test.rs", "Cargo.toml"];

// The user's exact diff — two hunks in one ```diff block
const response = "```diff\n" +
"--- a/src/lib.rs\n" +
"+++ b/src/lib.rs\n" +
"@@ -1,5 +1,4 @@\n" +
" #![no_std]\n" +
" \n" +
"-use soroban_sdk::{contract, contractimpl, Env, String, Vec};\n" +
"+use soroban_sdk::{contract, contractimpl, Env, String};\n" +
" \n" +
" const GREETING_KEY: &str = \"Greeting\";\n" +
"@@ -10,9 +10,7 @@\n" +
" #[contract]\n" +
" pub struct HelloWorld;\n" +
" \n" +
" #[contractimpl]\n" +
" impl HelloWorld {\n" +
"     /// Initialize the contract with a default greeting.\n" +
"-    pub fn __constructor(env: Env) {\n" +
"+    pub fn __constructor(env: Env)  {\n" +
"         let default = String::from_str(&env, \"Hello\");\n" +
"         env.storage().instance().set(&GREETING_KEY, &default);\n" +
"-\n" +
"-        default\n" +
"     }\n" +
" \n" +
"     /// Set a new greeting. Returns the new greeting.\n" +
"```";

console.log("=== Testing user's exact diff ===");
console.log("Response length:", response.length);

// First, test parsePatch directly on the diff content
const match = response.match(/```diff\n([\s\S]*?)```/);
if (match) {
  const diffContent = match[1];
  console.log("\n--- Direct parsePatch test ---");
  console.log("Diff content (first 100 chars):", diffContent.substring(0, 100));

  try {
    const patches = parsePatch(diffContent);
    console.log(`parsePatch returned ${patches.length} patch(es)`);
    for (const p of patches) {
      console.log(`  oldFileName: ${p.oldFileName}`);
      console.log(`  newFileName: ${p.newFileName}`);
      console.log(`  hunks: ${p.hunks?.length ?? 0}`);
      if (p.hunks) {
        for (const h of p.hunks) {
          console.log(`    @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
          console.log(`    lines (${h.lines?.length ?? 0}):`);
          for (const line of (h.lines || [])) {
            console.log(`      ${JSON.stringify(line)}`);
          }
        }
      }
    }
  } catch (e) {
    console.log("parsePatch threw:", e.message);
  }
}

// Now test via extractAndParseDiffs
console.log("\n--- extractAndParseDiffs test ---");
const diffs = extractAndParseDiffs(response, knownFiles);
console.log(`Parsed ${diffs.length} diff(s)`);
for (const d of diffs) {
  console.log(`  filePath: ${d.filePath}`);
  console.log(`  hunks: ${d.hunks.length}`);
  console.log(`  source: ${d.source}`);
}

if (diffs.length === 0) {
  console.log("\n⚠️ PARSER FAILED — 0 diffs found!");
} else {
  console.log("\n✓ Parser found the diff!");
}
