// Test the AI diff parser against a REAL OpenRouter LLM response.
// Uses the user's API key + model to generate a diff for a real Soroban
// build error, then verifies the parser catches it.

const AI_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

// A realistic build error scenario
const buildError = `error[E0308]: mismatched types
  --> src/lib.rs:14:9
   |
14 |         let default = String::from_str(&env, "Hello");
   |                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |                       expected \`String\`, found \`()\`
   |
   = note: \`String::from_str\` was removed in soroban-sdk 27.0.5
   = help: use \`env.string("...")\` instead

error: could not compile \`hello-world\` (lib) due to 1 previous error`;

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

async function test() {
  console.log("=== Testing OpenRouter + nemotron-3-ultra ===");
  console.log("Model:", MODEL);
  console.log("");

  // Step 1: Call OpenRouter with the build error + file content
  console.log("Step 1: Calling OpenRouter API...");

  const systemPrompt = `You are the Soroban.Build AI agent — a senior Soroban smart contract engineer.

🛑 CRITICAL RULE — READ FIRST 🛑

EVERY response that proposes a code change MUST include a GitHub-style
unified diff block. The user clicks "Accept" to apply your diff —
without a diff block, the user has NO WAY to apply your fix.

Format:
\`\`\`diff
--- a/path/to/file.rs
+++ b/path/to/file.rs
@@ -10,5 +10,8 @@
 existing line
-removed line
+added line
 existing line
\`\`\`

RULES:
  1. Output 1-3 sentences of explanation BEFORE the diff.
  2. The diff IS the answer — don't ramble in analysis.
  3. Use the EXACT file path from the project file list (provided below).
  4. For multi-file changes, output SEPARATE \`\`\`diff blocks per file.
  5. For new files, use /dev/null as the old file: --- /dev/null
  6. If you're not sure which file to edit, ASK — don't guess.

DO NOT:
  - Write more than 3 sentences of analysis before the diff
  - Show the full source file and stop there
  - List "potential issues" and output nothing
  - End your response without a diff block`;

  const userPrompt = `Fix this build error:

\`\`\`
${buildError}
\`\`\`

Project file list:
- src/lib.rs
- Cargo.toml

--- src/lib.rs ---
\`\`\`rust
${fileContent}
\`\`\`

Output the fix as a \`\`\`diff block with proper --- /+++ / @@ markers.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.log("❌ OpenRouter API error:", res.status, errText.substring(0, 300));
    process.exit(1);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content ?? "";

  console.log("Step 2: Got LLM response (" + responseText.length + " chars)");
  console.log("");
  console.log("=== RAW LLM RESPONSE ===");
  console.log(responseText);
  console.log("");
  console.log("=== END RAW RESPONSE ===");
  console.log("");

  // Step 3: Test the parser against the response
  console.log("Step 3: Testing parser against the response...");

  const { extractAndParseDiffs } = require("./src/lib/ai/ai-diff-parser");
  const knownFiles = ["src/lib.rs", "Cargo.toml"];
  const diffs = extractAndParseDiffs(responseText, knownFiles);

  console.log("");
  console.log("=== PARSER RESULT ===");
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

  console.log("");

  // Step 4: Test applying the diff to the file content
  if (diffs.length > 0) {
    console.log("Step 4: Testing applyDiffToContent...");

    // Import applyDiffToContent
    const { applyDiffToContent } = require("./src/lib/ai/ai-diff-parser");
    const patched = applyDiffToContent(fileContent, diffs[0]);

    if (patched) {
      console.log("✅ Diff applied successfully!");
      console.log("");
      console.log("=== PATCHED FILE ===");
      console.log(patched);
    } else {
      console.log("❌ applyDiffToContent returned null — diff didn't apply");
    }
  } else {
    console.log("❌ No diffs parsed — parser FAILED!");
    console.log("");
    console.log("Debugging: trying parsePatch directly...");

    const { parsePatch } = require("diff");

    // Extract fenced blocks
    const fenceMatch = responseText.match(/```[a-zA-Z]*\n([\s\S]*?)```/g);
    if (fenceMatch) {
      console.log(`Found ${fenceMatch.length} fenced block(s):`);
      for (let i = 0; i < fenceMatch.length; i++) {
        const content = fenceMatch[i].replace(/^```[a-zA-Z]*\n/, "").replace(/```$/, "");
        console.log(`\n--- Block ${i + 1} (${content.length} chars) ---`);
        console.log(content.substring(0, 300));

        try {
          const patches = parsePatch(content);
          console.log(`parsePatch: ${patches.length} patches, ${patches.reduce((s, p) => s + (p.hunks?.length ?? 0), 0)} hunks`);
        } catch (e) {
          console.log(`parsePatch threw: ${e.message}`);

          // Try fixing line counts
          console.log("Trying fixHunkLineCounts...");
          // Inline the fix for testing
          const fixed = fixHunkLineCounts(content);
          if (fixed !== content) {
            console.log("Line counts were different — retrying parsePatch...");
            try {
              const patches = parsePatch(fixed);
              console.log(`✅ Fixed! parsePatch: ${patches.length} patches, ${patches.reduce((s, p) => s + (p.hunks?.length ?? 0), 0)} hunks`);
            } catch (e2) {
              console.log(`❌ Still failed: ${e2.message}`);
            }
          } else {
            console.log("Line counts were already correct — issue is elsewhere");
          }
        }
      }
    } else {
      console.log("No fenced blocks found in response at all!");
    }
  }
}

function fixHunkLineCounts(text: string): string {
  const lines = text.split("\n");
  const fixed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hunkMatch = line?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch) {
      fixed.push(line ?? "");
      i++;
      continue;
    }
    const oldStart = parseInt(hunkMatch[1], 10);
    const newStart = parseInt(hunkMatch[3], 10);
    const bodyLines: string[] = [];
    i++;
    while (i < lines.length) {
      const bodyLine = lines[i];
      if (bodyLine?.startsWith("@@") || bodyLine?.startsWith("--- ") || bodyLine?.startsWith("+++ ") || bodyLine?.startsWith("diff --git")) break;
      if (bodyLine && bodyLine.length > 0 && !bodyLine.startsWith(" ") && !bodyLine.startsWith("-") && !bodyLine.startsWith("+") && !bodyLine.startsWith("\\")) break;
      bodyLines.push(bodyLine ?? "");
      i++;
    }
    let contextCount = 0, removedCount = 0, addedCount = 0;
    for (const bodyLine of bodyLines) {
      if (bodyLine.startsWith("-")) removedCount++;
      else if (bodyLine.startsWith("+")) addedCount++;
      else if (bodyLine.startsWith(" ") || bodyLine === "") contextCount++;
      else if (bodyLine.startsWith("\\")) {}
      else contextCount++;
    }
    const oldLines = contextCount + removedCount;
    const newLines = contextCount + addedCount;
    fixed.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    fixed.push(...bodyLines);
  }
  return fixed.join("\n");
}

test().catch(console.error);
