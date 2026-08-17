"use client";

import { create } from "zustand";
import { flattenFiles, type TreeNode } from "@/lib/soroban/sample-project";

/**
 * Autocomplete store — manages completion items for the Monaco editor.
 *
 * Purely client-side: parses the user's Rust source files to extract
 * functions, structs, enums, traits, constants, and type aliases.
 * Also includes a built-in database of common soroban-sdk API items
 * so autocomplete works even before a build.
 *
 * No server round-trip needed — everything happens in the browser.
 */

export interface CompletionItem {
  label: string;
  kind: "function" | "struct" | "enum" | "trait" | "constant" | "typeAlias" | "module" | "keyword" | "snippet" | "variable";
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextRules?: "InsertAsSnippet";
  module?: string;
}

interface AutocompleteState {
  items: CompletionItem[];
  ready: boolean;

  /** Parse all .rs files in the project tree + merge with built-in SDK items */
  build: (tree: TreeNode[]) => void;
  clear: () => void;
}

// ============================================================
// Built-in soroban-sdk API items (always available)
// ============================================================
const SOROBAN_SDK_ITEMS: CompletionItem[] = [
  // Types
  { label: "Env", kind: "struct", detail: "struct Env", documentation: "Soroban environment handle — provides access to storage, invocation, events, and the current caller.", module: "soroban_sdk" },
  { label: "Address", kind: "struct", detail: "struct Address", documentation: "A 32-byte Soroban account or contract address.", module: "soroban_sdk" },
  { label: "String", kind: "struct", detail: "struct String", documentation: "A Soroban string type.", module: "soroban_sdk" },
  { label: "Bytes", kind: "struct", detail: "struct Bytes", documentation: "A variable-length byte array.", module: "soroban_sdk" },
  { label: "BytesN", kind: "struct", detail: "struct BytesN<const N: usize>", documentation: "A fixed-length byte array.", module: "soroban_sdk" },
  { label: "Vec", kind: "struct", detail: "struct Vec<T>", documentation: "A Soroban vector.", module: "soroban_sdk" },
  { label: "Map", kind: "struct", detail: "struct Map<K, V>", documentation: "A Soroban map.", module: "soroban_sdk" },
  { label: "Symbol", kind: "struct", detail: "struct Symbol", documentation: "A Soroban symbol (small string).", module: "soroban_sdk" },
  { label: "Val", kind: "struct", detail: "struct Val", documentation: "A Soroban value.", module: "soroban_sdk" },
  { label: "i128", kind: "typeAlias", detail: "type i128", module: "soroban_sdk" },
  { label: "u128", kind: "typeAlias", detail: "type u128", module: "soroban_sdk" },
  { label: "i64", kind: "typeAlias", detail: "type i64", module: "soroban_sdk" },
  { label: "u64", kind: "typeAlias", detail: "type u64", module: "soroban_sdk" },
  { label: "i32", kind: "typeAlias", detail: "type i32", module: "soroban_sdk" },
  { label: "u32", kind: "typeAlias", detail: "type u32", module: "soroban_sdk" },
  { label: "bool", kind: "typeAlias", detail: "type bool", module: "soroban_sdk" },

  // Macros
  { label: "contract", kind: "keyword", detail: "#[contract]", documentation: "Marks a struct as a Soroban contract.", module: "soroban_sdk" },
  { label: "contractimpl", kind: "keyword", detail: "#[contractimpl]", documentation: "Marks an impl block as the contract's exported methods.", module: "soroban_sdk" },
  { label: "contracttype", kind: "keyword", detail: "#[contracttype]", documentation: "Marks a type as a Soroban contract type (serializable).", module: "soroban_sdk" },
  { label: "contracterror", kind: "keyword", detail: "#[contracterror]", documentation: "Marks an enum as a contract error type.", module: "soroban_sdk" },
  { label: "contractclient", kind: "keyword", detail: "#[contractclient]", documentation: "Generates a client struct for the contract.", module: "soroban_sdk" },

  // Env methods (as snippets)
  { label: "env.storage().instance().set", kind: "snippet", detail: "Set a value in instance storage", insertText: "env.storage().instance().set(&${1:Key}, &${2:value});", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.storage().instance().get", kind: "snippet", detail: "Get a value from instance storage", insertText: "env.storage().instance().get(&${1:Key}).unwrap_or_else(|| ${2:default})", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.storage().instance().has", kind: "snippet", detail: "Check if key exists in instance storage", insertText: "env.storage().instance().has(&${1:Key})", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.storage().persistent().set", kind: "snippet", detail: "Set a value in persistent storage", insertText: "env.storage().persistent().set(&${1:Key}, &${2:value});", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.storage().persistent().get", kind: "snippet", detail: "Get a value from persistent storage", insertText: "env.storage().persistent().get(&${1:Key}).unwrap_or_else(|| ${2:default})", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.events().publish", kind: "snippet", detail: "Publish an event", insertText: "env.events().publish((${1:topic},), ${2:data});", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "env.invoker()", kind: "function", detail: "fn env.invoker() -> Address", documentation: "Returns the address of the invoker.", module: "soroban_sdk" },
  { label: "env.current_contract_address", kind: "function", detail: "fn env.current_contract_address() -> Address", documentation: "Returns this contract's address.", module: "soroban_sdk" },
  { label: "env.ledger().timestamp", kind: "function", detail: "fn env.ledger().timestamp() -> u64", documentation: "Returns the current ledger timestamp.", module: "soroban_sdk" },
  { label: "env.ledger().sequence", kind: "function", detail: "fn env.ledger().sequence() -> u32", documentation: "Returns the current ledger sequence number.", module: "soroban_sdk" },

  // Common functions
  { label: "require_auth", kind: "snippet", detail: "Require authentication from an address", insertText: "${1:address}.require_auth();", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "String::from_str", kind: "snippet", detail: "Create a String from a &str", insertText: "String::from_str(&env, \"${1:text}\")", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },
  { label: "String::from_arg", kind: "function", detail: "fn String::from_arg(env, val) -> String", module: "soroban_sdk" },
  { label: "vec", kind: "snippet", detail: "Create a Vec", insertText: "vec![&env, ${1:items}]", insertTextRules: "InsertAsSnippet", module: "soroban_sdk" },

  // Imports
  { label: "soroban_sdk", kind: "module", detail: "use soroban_sdk::*", documentation: "Import the Soroban SDK", module: "soroban_sdk" },
  { label: "stellar_access", kind: "module", detail: "use stellar_access::*", documentation: "OpenZeppelin Access Control (Ownable, Roles)", module: "stellar_access" },
  { label: "stellar_tokens", kind: "module", detail: "use stellar_tokens::*", documentation: "OpenZeppelin Tokens (Fungible, Non-Fungible)", module: "stellar_tokens" },
  { label: "stellar_governance", kind: "module", detail: "use stellar_governance::*", documentation: "OpenZeppelin Governance utilities", module: "stellar_governance" },
];

// Common Rust standard items
const RUST_STD_ITEMS: CompletionItem[] = [
  { label: "pub fn", kind: "snippet", detail: "Public function", insertText: "pub fn ${1:name}(${2:args}) -> ${3:ReturnType} {\n    ${4:todo!()}\n}", insertTextRules: "InsertAsSnippet" },
  { label: "pub struct", kind: "snippet", detail: "Public struct", insertText: "pub struct ${1:Name} {\n    ${2:field}: ${3:Type},\n}", insertTextRules: "InsertAsSnippet" },
  { label: "pub enum", kind: "snippet", detail: "Public enum", insertText: "pub enum ${1:Name} {\n    ${2:Variant},\n}", insertTextRules: "InsertAsSnippet" },
  { label: "impl", kind: "snippet", detail: "Implementation block", insertText: "impl ${1:Type} {\n    ${2:// methods}\n}", insertTextRules: "InsertAsSnippet" },
  { label: "match", kind: "snippet", detail: "Match expression", insertText: "match ${1:expr} {\n    ${2:pattern} => ${3:body},\n    _ => todo!(),\n}", insertTextRules: "InsertAsSnippet" },
  { label: "if let", kind: "snippet", detail: "If-let pattern", insertText: "if let ${1:Some(val)} = ${2:expr} {\n    ${3:// body}\n}", insertTextRules: "InsertAsSnippet" },
  { label: "for loop", kind: "snippet", detail: "For loop", insertText: "for ${1:item} in ${2:iterable} {\n    ${3:// body}\n}", insertTextRules: "InsertAsSnippet" },
  { label: "#[test]", kind: "snippet", detail: "Test function", insertText: "#[test]\nfn ${1:test_name}() {\n    ${2:// test body}\n}", insertTextRules: "InsertAsSnippet" },
  { label: "#[contract]", kind: "snippet", detail: "Soroban contract attribute", insertText: "#[contract]\npub struct ${1:ContractName};", insertTextRules: "InsertAsSnippet" },
  { label: "#[contractimpl]", kind: "snippet", detail: "Soroban contract implementation", insertText: "#[contractimpl]\nimpl ${1:ContractName} {\n    pub fn ${2:method}(env: Env) -> ${3:ReturnType} {\n        ${4:todo!()}\n    }\n}", insertTextRules: "InsertAsSnippet" },
  { label: "#[contracttype]", kind: "snippet", detail: "Soroban contract type", insertText: "#[contracttype]\npub enum ${1:EnumName} {\n    ${2:Variant},\n}", insertTextRules: "InsertAsSnippet" },
  { label: "env.storage().instance().set", kind: "snippet", detail: "Set instance storage", insertText: "env.storage().instance().set(&${1:Key}, &${2:value});", insertTextRules: "InsertAsSnippet" },
  { label: "env.storage().instance().get", kind: "snippet", detail: "Get instance storage", insertText: "env.storage().instance().get(&${1:Key}).unwrap_or_else(|| ${2:default})", insertTextRules: "InsertAsSnippet" },
  { label: "require_auth", kind: "snippet", detail: "Require authorization", insertText: "${1:address}.require_auth();", insertTextRules: "InsertAsSnippet" },
  { label: "test (soroban)", kind: "snippet", detail: "Soroban test scaffold", insertText: "#[test]\nfn test_${1:name}() {\n    let env = Env::default();\n    let contract_id = env.register(${2:Contract}, ());\n    let client = ${2:Contract}Client::new(&env, &contract_id);\n\n    ${3:// assertions}\n}", insertTextRules: "InsertAsSnippet" },
];

/**
 * Parse a Rust source file to extract public items for autocomplete.
 *
 * §Intelligent (2026-08-16) — now also extracts:
 *   - Local variables (let bindings): `let x = ...`, `let mut y: Type = ...`
 *   - Function parameters: `fn foo(env: Env, counter: u32)`
 *   - Struct fields: `pub struct Foo { name: String, ... }`
 *   - Private functions (fn without pub)
 *   - Static items: `static COUNTER: u32 = 0;`
 *
 * This makes simple-mode autocomplete show local variables when you type
 * the first few letters — essential for a real editor experience.
 */
function parseRustSource(source: string, filePath: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const lines = source.split("\n");
  let currentDoc: string[] = [];
  // Track function scope so we know which `let` bindings are local to
  // the current function. We don't do full scoping (too complex for a
  // regex parser) — we just collect ALL let bindings from the file and
  // let Monaco's built-in filtering handle relevance.

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Collect doc comments
    if (line.startsWith("///")) {
      currentDoc.push(line.slice(3).trim());
      continue;
    }

    const doc = currentDoc.length > 0 ? currentDoc.join("\n") : undefined;

    // Reset doc on non-doc, non-attribute line
    if (line && !line.startsWith("//") && !line.startsWith("#[")) {
      currentDoc = [];
    }

    // pub fn OR fn (private functions too)
    const fnMatch = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{?/);
    if (fnMatch) {
      const name = fnMatch[1];
      const args = fnMatch[2].trim();
      const ret = (fnMatch[3] ?? "()").trim();
      const hasArgs = args && args !== "env: Env" && args !== "_env: Env";
      items.push({
        label: name,
        kind: "function",
        detail: `fn ${name}(${args}) -> ${ret}`,
        documentation: doc,
        insertText: hasArgs ? `${name}(\${1:args})` : `${name}()`,
        insertTextRules: "InsertAsSnippet",
        module: filePath,
      });

      // §Intelligent — also extract function parameters as completion items
      // so the user can reference them by name. e.g. `fn greet(env: Env, name: String)`
      // → adds `env` and `name` to the completion list.
      if (args) {
        const params = args.split(",").map(p => p.trim()).filter(Boolean);
        for (const param of params) {
          // Parse: `name: Type` or `name: &Type` or `mut name: Type` or `&self` / `&mut self`
          const paramMatch = param.match(/^(?:mut\s+)?([a-z_][a-z0-9_]*)\s*:\s*(?:&\s*(?:mut\s+)?)?([A-Za-z_][A-Za-z0-9_<>,\s]*)/);
          if (paramMatch) {
            const varName = paramMatch[1];
            const varType = paramMatch[2].trim();
            // Don't add if it's a common keyword
            if (varName !== "self" && varName !== "self_mut") {
              items.push({
                label: varName,
                kind: "variable",
                detail: `let ${varName}: ${varType}  // function param`,
                documentation: `Parameter of \`${name}\``,
                module: filePath,
              });
            }
          }
        }
      }
      continue;
    }

    // pub struct OR struct
    const structMatch = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      items.push({
        label: structMatch[1],
        kind: "struct",
        detail: `struct ${structMatch[1]}`,
        documentation: doc,
        module: filePath,
      });
      continue;
    }

    // pub enum OR enum
    const enumMatch = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      items.push({
        label: enumMatch[1],
        kind: "enum",
        detail: `enum ${enumMatch[1]}`,
        documentation: doc,
        module: filePath,
      });
      continue;
    }

    // pub trait OR trait
    const traitMatch = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      items.push({
        label: traitMatch[1],
        kind: "trait",
        detail: `trait ${traitMatch[1]}`,
        documentation: doc,
        module: filePath,
      });
      continue;
    }

    // pub const OR const OR static
    const constMatch = line.match(/^(?:pub\s+)?(?:const|static)\s+(?:mut\s+)?(\w+)\s*:\s*(.+?)(?:\s*=|$)/);
    if (constMatch) {
      items.push({
        label: constMatch[1],
        kind: "constant",
        detail: `const ${constMatch[1]}: ${constMatch[2].trim()}`,
        documentation: doc,
        module: filePath,
      });
      continue;
    }

    // pub type OR type
    const typeMatch = line.match(/^(?:pub\s+)?type\s+(\w+)\s*=\s*(.+?);/);
    if (typeMatch) {
      items.push({
        label: typeMatch[1],
        kind: "typeAlias",
        detail: `type ${typeMatch[1]} = ${typeMatch[2].trim()}`,
        documentation: doc,
        module: filePath,
      });
      continue;
    }

    // §Intelligent — let bindings (local variables)
    // Matches:
    //   let x = ...              → x (type inferred, no detail)
    //   let mut y = ...          → y
    //   let z: Type = ...        → z: Type
    //   let _env: Env = ...      → _env: Env
    // Does NOT match:
    //   let _ = ...              → underscore bindings are intentionally ignored
    //   let (_, x) = ...         → destructuring (too complex for regex)
    const letMatch = line.match(/^\s*let\s+(?:mut\s+)?([a-z_][a-z0-9_]*)\s*(?::\s*([A-Za-z_][A-Za-z0-9_<>,\s&]*))?\s*=/);
    if (letMatch) {
      const varName = letMatch[1];
      const varType = letMatch[2]?.trim();
      // Skip underscore-prefixed variables (intentionally unused)
      if (varName === "_" || varName.startsWith("_")) continue;
      items.push({
        label: varName,
        kind: "variable",
        detail: varType ? `let ${varName}: ${varType}` : `let ${varName}`,
        documentation: `Local variable in ${filePath}`,
        module: filePath,
      });
      continue;
    }

    // §Intelligent — struct fields (pub name: Type)
    // Matches indented field declarations inside a struct body:
    //   pub name: String,
    //   counter: u32,
    //   pub(crate) value: i64,
    const fieldMatch = line.match(/^\s+(?:pub\s+)?(?:\([^)]+\)\s+)?([a-z_][a-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_<>,\s&]*)/);
    if (fieldMatch && !line.includes("fn ") && !line.includes("let ") && !line.includes("use ")) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2].trim();
      // Skip common false positives (keywords that look like field names)
      if (["self", "return", "if", "else", "match", "for", "while", "loop", "break", "continue"].includes(fieldName)) continue;
      items.push({
        label: fieldName,
        kind: "variable",
        detail: `${fieldName}: ${fieldType}  // struct field`,
        documentation: `Field in ${filePath}`,
        module: filePath,
      });
      continue;
    }

    // use statements — collect as import suggestions
    const useMatch = line.match(/^use\s+([\w:]+)/);
    if (useMatch) {
      const parts = useMatch[1].split("::");
      const lastPart = parts[parts.length - 1];
      items.push({
        label: lastPart,
        kind: "module",
        detail: `use ${useMatch[1]}`,
        documentation: `Imported from ${useMatch[1]}`,
        module: filePath,
      });
    }
  }

  return items;
}

export const useAutocompleteStore = create<AutocompleteState>((set, get) => ({
  items: [],
  ready: false,

  build: (tree: TreeNode[]) => {
    // Parse all .rs files in the project
    const allFiles = flattenFiles(tree);
    const rustFiles = allFiles.filter((f) => f.path.endsWith(".rs"));

    const userItems: CompletionItem[] = [];
    for (const file of rustFiles) {
      const fileItems = parseRustSource(file.content, file.path);
      userItems.push(...fileItems);
    }

    // Merge: user items + built-in SDK items + Rust std items
    const allItems = [...userItems, ...SOROBAN_SDK_ITEMS, ...RUST_STD_ITEMS];

    set({ items: allItems, ready: true });
  },

  clear: () => set({ items: [], ready: false }),
}));
