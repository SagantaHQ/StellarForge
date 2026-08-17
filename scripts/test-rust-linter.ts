/**
 * Test for the intelligent simple-mode linter.
 *
 * Verifies all 8 lint rules detect their target issues + produce
 * the right diagnostics + quick fixes.
 */
import {
  lintRustSource,
  diagnosticsToMarkers,
  stripCommentsAndStrings,
} from "/home/z/my-project/analysis/soroban.build/src/lib/autocomplete/rust-linter.ts";

// We need to mock Monaco.MarkerSeverity for the test
const MockSeverity = { Error: 8, Warning: 4, Info: 2, Hint: 1 } as const;
// @ts-ignore — patch Monaco global
globalThis.Monaco = { MarkerSeverity: MockSeverity };

const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function hasDiag(diags: any[], code: string): boolean {
  return diags.some(d => d.code === code);
}

// ─── Test 1: Unused imports ──────────────────────────────────────────
const source1 = `#![no_std]
use soroban_sdk::{Env, String, Bytes};

pub fn greet(env: Env) -> String {
    String::from_str(&env, "hello")
}
`;
const diags1 = lintRustSource(source1);
record(
  "Unused import detected (Bytes is imported but never used)",
  hasDiag(diags1, "unused-import"),
  `codes: ${diags1.map(d => d.code).join(", ")}`
);
record(
  "Unused import has quick fix",
  diags1.find(d => d.code === "unused-import")?.quickFix !== undefined,
);

// ─── Test 2: Missing imports ─────────────────────────────────────────
const source2 = `#![no_std]

pub fn greet(env: Env) -> String {
    String::from_str(&env, "hello")
}
`;
const diags2 = lintRustSource(source2);
record(
  "Missing import detected (String used but not imported)",
  hasDiag(diags2, "missing-import"),
  `codes: ${diags2.map(d => d.code).join(", ")}`
);
record(
  "Missing import has quick fix",
  diags2.find(d => d.code === "missing-import")?.quickFix !== undefined,
);

// ─── Test 3: Unbalanced braces ───────────────────────────────────────
const source3 = `#![no_std]
pub fn broken() {
    if true {
        // missing closing brace
}
`;
const diags3 = lintRustSource(source3);
record(
  "Unclosed brace detected",
  hasDiag(diags3, "unclosed-opener"),
  `codes: ${diags3.map(d => d.code).join(", ")}`
);

// ─── Test 4: Unmatched closer ────────────────────────────────────────
const source4 = `#![no_std]
pub fn broken() {
    let x = (1 + 2);
    }
}
`;
const diags4 = lintRustSource(source4);
record(
  "Unmatched closing brace detected",
  hasDiag(diags4, "unmatched-closer") || hasDiag(diags4, "mismatched-brace"),
  `codes: ${diags4.map(d => d.code).join(", ")}`
);

// ─── Test 5: unwrap() usage ──────────────────────────────────────────
const source5 = `#![no_std]
pub fn risky(map: Option<u32>) -> u32 {
    map.unwrap()
}
`;
const diags5 = lintRustSource(source5);
record(
  "unwrap() flagged with info hint",
  hasDiag(diags5, "unwrap-panic"),
  `codes: ${diags5.map(d => d.code).join(", ")}`
);

// ─── Test 6: panic! usage ────────────────────────────────────────────
const source6 = `#![no_std]
pub fn bad() {
    panic!("oops")
}
`;
const diags6 = lintRustSource(source6);
record(
  "panic! flagged",
  hasDiag(diags6, "panic-in-contract"),
  `codes: ${diags6.map(d => d.code).join(", ")}`
);

// ─── Test 7: Missing #![no_std] ──────────────────────────────────────
const source7 = `
pub fn greet(env: Env) -> String {
    String::from_str(&env, "hello")
}
`;
const diags7 = lintRustSource(source7);
record(
  "Missing #![no_std] detected",
  hasDiag(diags7, "missing-no-std"),
  `codes: ${diags7.map(d => d.code).join(", ")}`
);
record(
  "Missing #![no_std] has quick fix",
  diags7.find(d => d.code === "missing-no-std")?.quickFix !== undefined,
);

// ─── Test 8: String::from_str without env ────────────────────────────
const source8 = `#![no_std]
use soroban_sdk::{Env, String};

pub fn bad(env: Env) -> String {
    String::from_str("hello")
}
`;
const diags8 = lintRustSource(source8);
record(
  "String::from_str without Env detected",
  hasDiag(diags8, "from-str-missing-env"),
  `codes: ${diags8.map(d => d.code).join(", ")}`
);

// ─── Test 9: Clean code produces no errors ───────────────────────────
const source9 = `#![no_std]
use soroban_sdk::{Env, String};

pub fn greet(env: Env, name: String) -> String {
    let greeting = String::from_str(&env, "Hello, ");
    greeting
}
`;
const diags9 = lintRustSource(source9);
const errors = diags9.filter(d => d.severity === MockSeverity.Error);
record(
  "Clean code produces no errors",
  errors.length === 0,
  `error codes: ${errors.map(d => d.code).join(", ")}`
);

// ─── Test 10: stripCommentsAndStrings works ──────────────────────────
const stripped = stripCommentsAndStrings(`let x = "}" // {
let y = 1;`);
record(
  "stripCommentsAndStrings removes string + comment braces",
  !stripped.includes('"') && !stripped.includes("//"),
  `result: ${JSON.stringify(stripped)}`
);

// ─── Test 11: diagnosticsToMarkers works ─────────────────────────────
const markers = diagnosticsToMarkers(diags1);
record(
  "diagnosticsToMarkers converts to Monaco marker format",
  markers.length > 0 && typeof markers[0].startLineNumber === "number" && typeof markers[0].message === "string",
  `first marker: ${JSON.stringify(markers[0]).slice(0, 100)}`
);

// ─── Summary ────────────────────────────────────────────────────────
console.log("\n=== Summary ===");
const pass = checks.filter(c => c.pass).length;
const fail = checks.length - pass;
console.log(`${pass}/${checks.length} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailed:");
  for (const c of checks.filter(c => !c.pass)) console.log(`  - ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  process.exit(1);
} else {
  console.log("\nAll checks passed ✓");
  process.exit(0);
}
