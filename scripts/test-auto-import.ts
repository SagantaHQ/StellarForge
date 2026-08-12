// Quick sanity test for auto-import logic.
// Run: npx tsx scripts/test-auto-import.ts

import {
  buildAutoImportEdit,
  isSymbolImported,
  isAutoImportableKind,
} from "../src/lib/autocomplete/auto-import";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

console.log("=== isAutoImportableKind ===");
check("struct is importable", isAutoImportableKind("struct"));
check("enum is importable", isAutoImportableKind("enum"));
check("trait is importable", isAutoImportableKind("trait"));
check("function NOT importable", !isAutoImportableKind("function"));
check("macro NOT importable", !isAutoImportableKind("macro"));
check("constant NOT importable", !isAutoImportableKind("constant"));

console.log("\n=== isSymbolImported ===");
{
  const src1 = "use soroban_sdk::Address;";
  check("single-form import detected", isSymbolImported(src1, "soroban_sdk", "Address"));
  check("non-imported symbol not detected", !isSymbolImported(src1, "soroban_sdk", "Env"));

  const src2 = "use soroban_sdk::{Address, Env, BytesN};";
  check("group-form import detected (Address)", isSymbolImported(src2, "soroban_sdk", "Address"));
  check("group-form import detected (Env)", isSymbolImported(src2, "soroban_sdk", "Env"));
  check("group-form import detected (BytesN)", isSymbolImported(src2, "soroban_sdk", "BytesN"));
  check("non-imported symbol not detected", !isSymbolImported(src2, "soroban_sdk", "Map"));

  const src3 = "use soroban_sdk::{\n    Address,\n    Env,\n    BytesN,\n};";
  check("multi-line group import detected (Address)", isSymbolImported(src3, "soroban_sdk", "Address"));
  check("multi-line group import detected (Env)", isSymbolImported(src3, "soroban_sdk", "Env"));
  check("non-imported symbol not detected", !isSymbolImported(src3, "soroban_sdk", "Map"));

  const src4 = "use soroban_sdk::*;";
  check("glob import covers everything", isSymbolImported(src4, "soroban_sdk", "Anything"));

  const src5 = "use soroban_sdk::Address as Addr;";
  check("aliased import detected", isSymbolImported(src5, "soroban_sdk", "Address"));

  // Dash vs underscore normalization
  const src6 = "use stellar_strkey::Strkey;";
  check("dash crate name matches underscore use", isSymbolImported(src6, "stellar-strkey", "Strkey"));
}

console.log("\n=== buildAutoImportEdit ===");
{
  // Case 1: extend single-form use
  const src1 = "use soroban_sdk::Address;\n\nfn main() {}";
  const r1 = buildAutoImportEdit(src1, { crate: "soroban_sdk", symbol: "Env", kind: "struct" });
  check("case 1: extend single-form use returns edit", r1 !== null);
  if (r1) {
    console.log(`       desc: ${r1.description}`);
    console.log(`       text: ${JSON.stringify(r1.edit.text)}`);
    // Apply the edit and verify the result.
    const lines = src1.split("\n");
    const line = lines[r1.edit.range.startLineNumber - 1];
    const before = line.slice(0, r1.edit.range.startColumn - 1);
    const after = line.slice(r1.edit.range.endColumn - 1);
    const newLine = before + r1.edit.text + after;
    const result = [...lines];
    result[r1.edit.range.startLineNumber - 1] = newLine;
    const finalSrc = result.join("\n");
    console.log(`       result line 1: ${finalSrc.split("\n")[0]}`);
    check("case 1: result converts to group form", finalSrc.includes("use soroban_sdk::{Address, Env};"));
  }

  // Case 2: extend group-form use (single line)
  const src2 = "use soroban_sdk::{Address, Env};\n\nfn main() {}";
  const r2 = buildAutoImportEdit(src2, { crate: "soroban_sdk", symbol: "BytesN", kind: "struct" });
  check("case 2: extend group-form use returns edit", r2 !== null);
  if (r2) {
    console.log(`       desc: ${r2.description}`);
    // Apply edit
    const lines = src2.split("\n");
    const line = lines[r2.edit.range.startLineNumber - 1];
    const before = line.slice(0, r2.edit.range.startColumn - 1);
    const after = line.slice(r2.edit.range.endColumn - 1);
    const newLine = before + r2.edit.text + after;
    const result = [...lines];
    result[r2.edit.range.startLineNumber - 1] = newLine;
    const finalSrc = result.join("\n");
    console.log(`       result: ${finalSrc.split("\n")[0]}`);
    check("case 2: result adds BytesN", finalSrc.includes("BytesN"));
    check("case 2: result has comma before new symbol", finalSrc.includes(", BytesN"));
  }

  // Case 3: extend multi-line group-form use
  const src3 = "use soroban_sdk::{\n    Address,\n    Env,\n};\n\nfn main() {}";
  const r3 = buildAutoImportEdit(src3, { crate: "soroban_sdk", symbol: "BytesN", kind: "struct" });
  check("case 3: extend multi-line group use returns edit", r3 !== null);
  if (r3) {
    console.log(`       desc: ${r3.description}`);
    // Apply edit at line/col
    const lines = src3.split("\n");
    const line = lines[r3.edit.range.startLineNumber - 1];
    const before = line.slice(0, r3.edit.range.startColumn - 1);
    const after = line.slice(r3.edit.range.endColumn - 1);
    const newLine = before + r3.edit.text + after;
    const result = [...lines];
    result[r3.edit.range.startLineNumber - 1] = newLine;
    const finalSrc = result.join("\n");
    console.log(`       result lines:`);
    finalSrc.split("\n").slice(0, 6).forEach((l, i) => console.log(`         ${i + 1}: ${l}`));
    check("case 3: result has BytesN", finalSrc.includes("BytesN"));
  }

  // Case 4: insert new use when none exists for crate
  const src4 = "use soroban_sdk::Address;\n\nfn main() {\n    let x = Strkey::from_string(\"\");\n}";
  const r4 = buildAutoImportEdit(src4, { crate: "stellar-strkey", symbol: "Strkey", kind: "enum" });
  check("case 4: insert new use returns edit", r4 !== null);
  if (r4) {
    console.log(`       desc: ${r4.description}`);
    // Insert
    const lines = src4.split("\n");
    const insertLine = r4.edit.range.startLineNumber;
    const newLines = [
      ...lines.slice(0, insertLine - 1),
      r4.edit.text.replace(/\n$/, ""),
      ...lines.slice(insertLine - 1),
    ];
    const finalSrc = newLines.join("\n");
    console.log(`       result:`);
    finalSrc.split("\n").slice(0, 6).forEach((l, i) => console.log(`         ${i + 1}: ${l}`));
    check("case 4: result has new use stellar_strkey", finalSrc.includes("use stellar_strkey::Strkey;"));
    // Verify inserted AFTER existing use
    const addressLine = finalSrc.split("\n").findIndex(l => l.includes("use soroban_sdk::Address"));
    const strkeyLine = finalSrc.split("\n").findIndex(l => l.includes("use stellar_strkey::Strkey"));
    check("case 4: new use comes after existing use", strkeyLine > addressLine);
  }

  // Case 5: no existing use statements — insert at top
  const src5 = "fn main() {\n    let x = Address::new();\n}";
  const r5 = buildAutoImportEdit(src5, { crate: "soroban_sdk", symbol: "Address", kind: "struct" });
  check("case 5: insert at top returns edit", r5 !== null);
  if (r5) {
    console.log(`       desc: ${r5.description}`);
    const lines = src5.split("\n");
    const newLines = [
      r5.edit.text.replace(/\n$/, ""),
      ...lines,
    ];
    const finalSrc = newLines.join("\n");
    console.log(`       result first line: ${finalSrc.split("\n")[0]}`);
    check("case 5: result has new use at top", finalSrc.startsWith("use soroban_sdk::Address;"));
  }

  // Case 6: already imported — no edit
  const src6 = "use soroban_sdk::Address;";
  const r6 = buildAutoImportEdit(src6, { crate: "soroban_sdk", symbol: "Address", kind: "struct" });
  check("case 6: already imported returns null", r6 === null);

  // Case 7: glob import — no edit needed
  const src7 = "use soroban_sdk::*;";
  const r7 = buildAutoImportEdit(src7, { crate: "soroban_sdk", symbol: "Address", kind: "struct" });
  check("case 7: glob import returns null", r7 === null);

  // Case 8: function kind — not auto-importable
  const r8 = buildAutoImportEdit("fn main() {}", { crate: "soroban_sdk", symbol: "len", kind: "function" });
  check("case 8: function kind returns null", r8 === null);

  // Case 9: shadowing conflict — name already imported from another crate
  const src9 = "use other_crate::Address;";
  const r9 = buildAutoImportEdit(src9, { crate: "soroban_sdk", symbol: "Address", kind: "struct" });
  check("case 9: name conflict returns null", r9 === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
