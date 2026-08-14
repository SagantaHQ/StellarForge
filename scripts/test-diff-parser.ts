import { parseDiffFromResponse } from "../src/lib/ai/context-assembler";

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

console.log("=== Testing parseDiffFromResponse ===");
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
} else if (diffs[0].filePath === "(unknown file)") {
  console.log("\n⚠️ FILE PATH IS '(unknown file)' — parser couldn't extract the path!");
} else {
  console.log("\n✓ Diff parsed correctly with file path:", diffs[0].filePath);
}
