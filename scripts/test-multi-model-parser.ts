/**
 * Comprehensive multi-model parser test.
 *
 * Tests 10 different scenarios against multiple free OpenRouter models.
 * Catches all outcomes: proper diffs, malformed diffs, missing diffs,
 * wrong line counts, custom delimiters, multi-file, new files, etc.
 *
 * Run: OPENROUTER_API_KEY=sk-or-... npx tsx scripts/test-multi-model-parser.ts
 */

import { extractAndParseDiffs, applyDiffToContent } from "../src/lib/ai/ai-diff-parser";

const AI_KEY = process.env.OPENROUTER_API_KEY || "";
if (!AI_KEY) {
  console.error("Set OPENROUTER_API_KEY env var");
  process.exit(1);
}

const MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3.5-lightning:free",
];

const SYSTEM_PROMPT = `You are the Soroban.Build AI agent — a senior Soroban smart contract engineer.

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
  - End your response without a diff block`;

interface TestScenario {
  name: string;
  prompt: string;
  knownFiles: string[];
  fileContents: Record<string, string>;
}

// 10 diverse test scenarios
const SCENARIOS: TestScenario[] = [
  // 1. Simple build error fix (single line change)
  {
    name: "1. Simple build error (1-line fix)",
    knownFiles: ["src/lib.rs", "Cargo.toml"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\nconst GREETING_KEY: &str = "Greeting";\n#[contract]\npub struct HelloWorld;\n#[contractimpl]\nimpl HelloWorld {\n    pub fn __constructor(env: Env) {\n        let default = String::from_str(&env, "Hello");\n        env.storage().instance().set(&GREETING_KEY, &default);\n    }\n}`,
    },
    prompt: `Fix this build error: String::from_str was removed in soroban-sdk 27.0.5. Use env.string("Hello") instead.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the fix as a \`\`\`diff block.`,
  },

  // 2. Add a new function
  {
    name: "2. Add new function (insertion)",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\n#[contract]\npub struct Counter;\n#[contractimpl]\nimpl Counter {\n    pub fn get(env: Env) -> u32 { 0 }\n}`,
    },
    prompt: `Add an increment function that reads the current value from storage, increments by 1, stores the new value, and returns it.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as a \`\`\`diff block.`,
  },

  // 3. Multi-hunk same file (two changes far apart)
  {
    name: "3. Multi-hunk same file",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String, Symbol, symbol_short};\nconst ADMIN_KEY: Symbol = symbol_short!("ADMIN");\nconst COUNT_KEY: Symbol = symbol_short!("COUNT");\n#[contract]\npub struct Token;\n#[contractimpl]\nimpl Token {\n    pub fn init(env: Env, admin: Address) {\n        env.storage().instance().set(&ADMIN_KEY, &admin);\n        env.storage().instance().set(&COUNT_KEY, &0u32);\n    }\n    pub fn get_count(env: Env) -> u32 {\n        env.storage().instance().get(&COUNT_KEY).unwrap_or(0)\n    }\n    pub fn mint(env: Env, to: Address, amount: u32) {\n        let count = Self::get_count(env.clone());\n        env.storage().instance().set(&COUNT_KEY, &(count + amount));\n    }\n}`,
    },
    prompt: `Add require_auth(&to) in the mint function, and change the return type of get_count to u64. Make both changes.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as a \`\`\`diff block.`,
  },

  // 4. New file creation
  {
    name: "4. New file creation",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n#[contract]\npub struct Storage;\n#[contractimpl]\nimpl Storage {\n    pub fn set(env: Env, key: u32, val: u32) {\n        env.storage().instance().set(&key, &val);\n    }\n}`,
    },
    prompt: `Create a new file src/events.rs that defines a contract event struct and a helper function to emit events. Then add a mod events; declaration to src/lib.rs.\n\nProject files: src/lib.rs\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as separate \`\`\`diff blocks (one per file).`,
  },

  // 5. Remove code (deletion-heavy diff)
  {
    name: "5. Remove code (deletion-heavy)",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\n#[contract]\npub struct HelloWorld;\n#[contractimpl]\nimpl HelloWorld {\n    pub fn __constructor(env: Env) {\n        let default = env.string("Hello");\n        env.storage().instance().set(&"key", &default);\n    }\n    pub fn unused_function(env: Env) {\n        // This function is not used\n        let _ = env.string("unused");\n    }\n    pub fn greet(env: Env) -> String {\n        env.string("Hello")\n    }\n}`,
    },
    prompt: `Remove the unused_function entirely. It's dead code.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the fix as a \`\`\`diff block.`,
  },

  // 6. Fix missing require_auth (security fix)
  {
    name: "6. Security fix (add require_auth)",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, Address, String};\n#[contract]\npub struct Token;\n#[contractimpl]\nimpl Token {\n    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {\n        let balance_from = env.storage().instance().get(&from).unwrap_or(0);\n        let balance_to = env.storage().instance().get(&to).unwrap_or(0);\n        env.storage().instance().set(&from, &(balance_from - amount));\n        env.storage().instance().set(&to, &(balance_to + amount));\n    }\n}`,
    },
    prompt: `This transfer function has a security vulnerability — it doesn't call require_auth on the 'from' address. Add require_auth(&from) at the start of the function.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the fix as a \`\`\`diff block.`,
  },

  // 7. Refactor (rename + restructure)
  {
    name: "7. Refactor (rename function)",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\n#[contract]\npub struct Greeter;\n#[contractimpl]\nimpl Greeter {\n    pub fn do_thing(env: Env) -> String {\n        env.string("hello")\n    }\n}`,
    },
    prompt: `Rename the function 'do_thing' to 'get_greeting' for clarity.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as a \`\`\`diff block.`,
  },

  // 8. Add error handling
  {
    name: "8. Add error handling",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\n#[contract]\npub struct Vault;\n#[contractimpl]\nimpl Vault {\n    pub fn withdraw(env: Env, amount: u32) -> bool {\n        let balance: u32 = env.storage().instance().get(&"bal").unwrap_or(0);\n        if amount > balance {\n            return false;\n        }\n        env.storage().instance().set(&"bal", &(balance - amount));\n        true\n    }\n}`,
    },
    prompt: `Add a contract error enum with InsufficientBalance error, and use panic_with_error! instead of returning false when the balance is insufficient.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as a \`\`\`diff block.`,
  },

  // 9. Multi-file (update Cargo.toml + src/lib.rs)
  {
    name: "9. Multi-file (Cargo.toml + lib.rs)",
    knownFiles: ["src/lib.rs", "Cargo.toml"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n#[contract]\npub struct Contract;\n#[contractimpl]\nimpl Contract {\n    pub fn hello(env: Env) -> u32 { 42 }\n}`,
      "Cargo.toml": `[package]\nname = "contract"\nversion = "0.1.0"\nedition = "2021"\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nsoroban-sdk = "27.0.5"`,
    },
    prompt: `Add a new dependency on stellar-strkey in Cargo.toml, and add a use statement for stellar_strkey::Strkey in src/lib.rs.\n\n--- Cargo.toml ---\n\`\`\`toml\n{{Cargo.toml}}\n\`\`\`\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput separate \`\`\`diff blocks per file.`,
  },

  // 10. Large context (multiple functions to modify)
  {
    name: "10. Large context (multiple modifications)",
    knownFiles: ["src/lib.rs"],
    fileContents: {
      "src/lib.rs": `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String, Address, Symbol, symbol_short};\nconst OWNER_KEY: Symbol = symbol_short!("OWNER");\nconst NAME_KEY: Symbol = symbol_short!("NAME");\nconst SYM_KEY: Symbol = symbol_short!("SYM");\nconst SUPPLY_KEY: Symbol = symbol_short!("SUPPLY");\n#[contract]\npub struct Token;\n#[contractimpl]\nimpl Token {\n    pub fn init(env: Env, owner: Address, name: String, symbol: String) {\n        env.storage().instance().set(&OWNER_KEY, &owner);\n        env.storage().instance().set(&NAME_KEY, &name);\n        env.storage().instance().set(&SYM_KEY, &symbol);\n        env.storage().instance().set(&SUPPLY_KEY, &0u128);\n    }\n    pub fn name(env: Env) -> String {\n        env.storage().instance().get(&NAME_KEY).unwrap_or(env.string(""))\n    }\n    pub fn symbol(env: Env) -> String {\n        env.storage().instance().get(&SYM_KEY).unwrap_or(env.string(""))\n    }\n    pub fn supply(env: Env) -> u128 {\n        env.storage().instance().get(&SUPPLY_KEY).unwrap_or(0)\n    }\n    pub fn mint(env: Env, to: Address, amount: u128) {\n        let supply = Self::supply(env.clone());\n        env.storage().instance().set(&SUPPLY_KEY, &(supply + amount));\n    }\n}`,
    },
    prompt: `Make these changes: (1) Add require_auth(&to) in mint function. (2) Change supply() to return u256 instead of u128. (3) Add a new function balance_of(env, addr: Address) -> u128 that returns 0.\n\n--- src/lib.rs ---\n\`\`\`rust\n{{src/lib.rs}}\n\`\`\`\n\nOutput the changes as a \`\`\`diff block.`,
  },
];

async function callModel(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model,
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
      return `[ERROR ${res.status}] ${errText.substring(0, 100)}`;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    return `[FETCH_ERROR] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function testParser(response: string, knownFiles: string[]) {
  const diffs = extractAndParseDiffs(response, knownFiles);
  return {
    diffCount: diffs.length,
    details: diffs.map((d) => ({
      file: d.filePath,
      hunks: d.hunks.length,
      source: d.source,
      totalLines: d.hunks.reduce((s, h) => s + h.lines.length, 0),
    })),
  };
}

function formatResult(model: string, scenario: string, response: string, result: ReturnType<typeof testParser>): string {
  const status = result.diffCount > 0 ? "✅ PASS" : "❌ FAIL";
  const responsePreview = response.substring(0, 80).replace(/\n/g, " ");
  const diffSummary = result.details.map((d) => `${d.file}(${d.hunks}h,${d.totalLines}l,${d.source})`).join(", ");
  return `  ${status} | ${model.substring(0, 30).padEnd(30)} | ${diffSummary || "no diffs"} | ${responsePreview}...`;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  MULTI-MODEL PARSER TEST — 10 scenarios × multiple models");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Pick 5 models that are likely to produce code (skip tiny ones)
  const testModels = MODELS.slice(0, 6);

  const allResults: { model: string; scenario: string; pass: boolean; diffCount: number }[] = [];
  let totalPass = 0;
  let totalFail = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n─── ${scenario.name} ───`);

    // Replace file content placeholders in the prompt
    let prompt = scenario.prompt;
    for (const [path, content] of Object.entries(scenario.fileContents)) {
      prompt = prompt.replace(`{{${path}}}`, content);
    }

    for (const model of testModels) {
      const response = await callModel(model, SYSTEM_PROMPT, prompt);

      // Skip error responses
      if (response.startsWith("[ERROR") || response.startsWith("[FETCH_ERROR")) {
        console.log(`  ⚠️ SKIP  | ${model.substring(0, 30).padEnd(30)} | ${response.substring(0, 60)}`);
        continue;
      }

      // Skip empty responses
      if (!response.trim()) {
        console.log(`  ⚠️ SKIP  | ${model.substring(0, 30).padEnd(30)} | (empty response)`);
        continue;
      }

      const result = testParser(response, scenario.knownFiles);
      console.log(formatResult(model, scenario.name, response, result));

      if (result.diffCount > 0) {
        totalPass++;
        allResults.push({ model, scenario: scenario.name, pass: true, diffCount: result.diffCount });
      } else {
        totalFail++;
        allResults.push({ model, scenario: scenario.name, pass: false, diffCount: 0 });
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Summary
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Total tests: ${totalPass + totalFail}`);
  console.log(`  Passed: ${totalPass} ✅`);
  console.log(`  Failed: ${totalFail} ❌`);
  console.log("");

  // Per-model breakdown
  console.log("  Per-model results:");
  for (const model of testModels) {
    const modelResults = allResults.filter((r) => r.model === model);
    const modelPass = modelResults.filter((r) => r.pass).length;
    const modelFail = modelResults.filter((r) => !r.pass).length;
    console.log(`    ${model.substring(0, 35).padEnd(35)} ${modelPass}/${modelPass + modelFail} passed`);
  }

  console.log("");

  // Per-scenario breakdown
  console.log("  Per-scenario results:");
  for (const scenario of SCENARIOS) {
    const scenarioResults = allResults.filter((r) => r.scenario === scenario.name);
    const scenarioPass = scenarioResults.filter((r) => r.pass).length;
    const scenarioFail = scenarioResults.filter((r) => !r.pass).length;
    console.log(`    ${scenario.name.padEnd(40)} ${scenarioPass}/${scenarioPass + scenarioFail} passed`);
  }

  // Show failed tests in detail
  const failed = allResults.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log("");
    console.log("  Failed tests (for debugging):");
    for (const f of failed) {
      console.log(`    ${f.model.substring(0, 30)} — ${f.scenario}`);
    }
  }

  console.log("");
  process.exit(0);
}

main().catch(console.error);
