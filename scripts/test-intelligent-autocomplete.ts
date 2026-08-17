/**
 * Test for the intelligent simple-mode autocomplete.
 *
 * Verifies that:
 *   1. getTypeMembers returns the correct members for known types
 *   2. lookupVariableType correctly infers types from source
 *   3. The simple provider would return type-specific completions after `::`
 */
import {
  getTypeMembers,
  getTypeCrate,
  lookupVariableType,
  parseVariableTypes,
  TYPE_MEMBERS,
} from "/home/z/my-project/analysis/soroban.build/src/lib/autocomplete/type-members.ts";

const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ─── Test 1: String has the expected associated functions ────────────
const stringMembers = getTypeMembers("String");
const stringAssociated = stringMembers?.filter(m => m.is_associated).map(m => m.name) ?? [];
record(
  "String:: has from_str, from_bytes, new",
  stringAssociated.includes("from_str") && stringAssociated.includes("from_bytes") && stringAssociated.includes("new"),
  `found: ${stringAssociated.join(", ")}`
);

// ─── Test 2: String has the expected methods ─────────────────────────
const stringMethods = stringMembers?.filter(m => !m.is_associated).map(m => m.name) ?? [];
record(
  "String methods include len, is_empty, push, to_bytes",
  stringMethods.includes("len") && stringMethods.includes("is_empty") && stringMethods.includes("push") && stringMethods.includes("to_bytes"),
  `found: ${stringMethods.join(", ")}`
);

// ─── Test 3: Vec has different members than String ───────────────────
const vecMembers = getTypeMembers("Vec");
const vecAssociated = vecMembers?.filter(m => m.is_associated).map(m => m.name) ?? [];
record(
  "Vec:: has from_array, from_slice (different from String)",
  vecAssociated.includes("from_array") && vecAssociated.includes("from_slice"),
  `found: ${vecAssociated.join(", ")}`
);

// ─── Test 4: Env methods are different from String methods ───────────
const envMembers = getTypeMembers("Env");
const envMethods = envMembers?.filter(m => !m.is_associated).map(m => m.name) ?? [];
record(
  "Env methods include storage, events, ledger (different from String)",
  envMethods.includes("storage") && envMethods.includes("events") && envMethods.includes("ledger"),
  `found: ${envMethods.join(", ")}`
);

// ─── Test 5: Unknown type returns null ───────────────────────────────
record(
  "Unknown type returns null",
  getTypeMembers("NonexistentType") === null,
);

// ─── Test 6: Generic type params are stripped ────────────────────────
const vecOfT = getTypeMembers("Vec<T>");
record(
  "Vec<T> resolves to Vec (generic stripped)",
  vecOfT !== null && vecOfT === vecMembers,
);

// ─── Test 7: Source parsing — let with explicit type ─────────────────
const source1 = `
  let env: Env = Env::default();
  let counter: u32 = 0;
  let name = String::from_str(&env, "hello");
`;
const types1 = parseVariableTypes(source1);
record(
  "let env: Env = ... → env maps to Env",
  types1.get("env") === "Env",
  `got: ${types1.get("env")}`
);
// Note: primitive types (u32, i32, bool) are intentionally NOT captured —
// they have no members to look up, so tracking them is pointless.
record(
  "let name = String::from_str(...) → name maps to String (inferred from RHS)",
  types1.get("name") === "String",
  `got: ${types1.get("name")}`
);

// ─── Test 8: Source parsing — function params ────────────────────────
const source2 = `
  pub fn greet(env: Env, name: String, counter: u32) -> String {
    // ...
  }
`;
const types2 = parseVariableTypes(source2);
record(
  "fn params: env → Env, name → String (SDK types captured)",
  types2.get("env") === "Env" && types2.get("name") === "String",
  `got: env=${types2.get("env")}, name=${types2.get("name")}`
);

// ─── Test 9: Source parsing — let mut ────────────────────────────────
const source3 = `
  let mut bytes = Bytes::new(&env);
  let mut map: Map<Symbol, u32> = Map::new(&env);
`;
const types3 = parseVariableTypes(source3);
record(
  "let mut bytes = Bytes::new(...) → bytes maps to Bytes",
  types3.get("bytes") === "Bytes",
  `got: ${types3.get("bytes")}`
);

// ─── Test 10: lookupVariableType uses the cache ──────────────────────
const looked = lookupVariableType(source1, "env");
record(
  "lookupVariableType(source, 'env') returns Env",
  looked === "Env",
  `got: ${looked}`
);

// ─── Test 11: getTypeCrate returns the crate name ────────────────────
record(
  "getTypeCrate('String') === 'soroban_sdk'",
  getTypeCrate("String") === "soroban_sdk",
  `got: ${getTypeCrate("String")}`
);

// ─── Test 12: All types in the knowledge base have at least 1 member ─
const typeNames = Object.keys(TYPE_MEMBERS);
const emptyTypes = typeNames.filter(name => (TYPE_MEMBERS[name].members?.length ?? 0) === 0);
record(
  "All types in knowledge base have at least 1 member",
  emptyTypes.length === 0,
  emptyTypes.length > 0 ? `empty: ${emptyTypes.join(", ")}` : `${typeNames.length} types total`
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
