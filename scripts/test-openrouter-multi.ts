// Test parser against a second OpenRouter call — multi-file diff request
import { extractAndParseDiffs, applyDiffToContent } from "../src/lib/ai/ai-diff-parser";

// API key removed for security — set via OPENROUTER_API_KEY env var
const AI_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const systemPrompt = `You are the StellarForge AI agent — a senior Soroban smart contract engineer.

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
  3. Use the EXACT file path from the project file list.
  4. For multi-file changes, output SEPARATE \`\`\`diff blocks per file.
  5. For new files, use /dev/null as the old file: --- /dev/null
  6. If you're not sure which file to edit, ASK — don't guess.

DO NOT:
  - Write more than 3 sentences of analysis before the diff
  - Show the full source file and stop there
  - List "potential issues" and output nothing
  - End your response without a diff block`;

async function runTest(testName: string, userPrompt: string, knownFiles: string[]) {
  console.log(`\n=== ${testName} ===`);

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
    console.log(`❌ API error: ${res.status} ${errText.substring(0, 200)}`);
    return;
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content ?? "";

  console.log(`LLM response (${responseText.length} chars):`);
  console.log("---");
  console.log(responseText.substring(0, 500));
  console.log("---");

  // Parse
  const diffs = extractAndParseDiffs(responseText, knownFiles);
  console.log(`\nParsed ${diffs.length} diff(s)`);
  for (const d of diffs) {
    console.log(`  ${d.filePath}: ${d.hunks.length} hunk(s), source=${d.source}`);
    for (const h of d.hunks) {
      const added = h.lines.filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).length;
      const removed = h.lines.filter((l: string) => l.startsWith("-") && !l.startsWith("---")).length;
      console.log(`    @@ -${h.oldStart} +${h.newStart} @@ (${h.lines.length} lines: +${added} -${removed})`);
    }
  }

  if (diffs.length > 0) {
    console.log("✅ PASS — parser found the diff(s)");
  } else {
    console.log("❌ FAIL — parser found 0 diffs");
  }
}

async function main() {
  // Test 1: Simple build error fix
  await runTest(
    "Test 1: Simple build error fix",
    `Fix this build error:

\`\`\`
error[E0308]: mismatched types
  --> src/lib.rs:14:9
   |
14 |         let default = String::from_str(&env, "Hello");
   |                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |                       expected \`String\`, found \`()\`
   |
   = note: \`String::from_str\` was removed in soroban-sdk 27.0.5
   = help: use \`env.string("...")\` instead
\`\`\`

Project file list:
- src/lib.rs
- Cargo.toml

--- src/lib.rs ---
\`\`\`rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, String};
const GREETING_KEY: &str = "Greeting";
#[contract]
pub struct HelloWorld;
#[contractimpl]
impl HelloWorld {
    pub fn __constructor(env: Env) {
        let default = String::from_str(&env, "Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
    }
    pub fn get_greeting(env: Env) -> String {
        env.storage().instance().get(&GREETING_KEY).unwrap_or_else(|| String::from_str(&env, "Hello"))
    }
}
\`\`\`

Output the fix as a \`\`\`diff block.`,
    ["src/lib.rs", "Cargo.toml"]
  );

  // Test 2: Add a new function
  await runTest(
    "Test 2: Add a new function",
    `Add a set_greeting function to this contract that takes a String argument, sets it in storage, and returns the new greeting.

Project file list:
- src/lib.rs
- Cargo.toml

--- src/lib.rs ---
\`\`\`rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, String};
const GREETING_KEY: &str = "Greeting";
#[contract]
pub struct HelloWorld;
#[contractimpl]
impl HelloWorld {
    pub fn __constructor(env: Env) {
        let default = env.string("Hello");
        env.storage().instance().set(&GREETING_KEY, &default);
    }
    pub fn get_greeting(env: Env) -> String {
        env.storage().instance().get(&GREETING_KEY).unwrap_or_else(|| env.string("Hello"))
    }
}
\`\`\`

Output the changes as a \`\`\`diff block.`,
    ["src/lib.rs", "Cargo.toml"]
  );

  // Test 3: Multi-file change
  await runTest(
    "Test 3: Multi-file change (add a new file)",
    `Create a new file called src/greeting.rs that exports a function \`build_greeting(env: &Env, name: &str) -> String\` which returns "Hello, {name}!". Then update src/lib.rs to use it.

Project file list:
- src/lib.rs
- Cargo.toml

--- src/lib.rs ---
\`\`\`rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, String};
#[contract]
pub struct HelloWorld;
#[contractimpl]
impl HelloWorld {
    pub fn greet(env: Env, name: String) -> String {
        env.string("Hello")
    }
}
\`\`\`

Output the changes as separate \`\`\`diff blocks (one per file).`,
    ["src/lib.rs", "src/greeting.rs", "Cargo.toml"]
  );
}

main().catch(console.error);
