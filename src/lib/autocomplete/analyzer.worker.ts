/// <reference lib="webworker" />

/**
 * Web Worker: Tree-sitter Rust analyzer for Soroban.Build
 *
 * Runs tree-sitter incremental parsing in a Web Worker (off the UI thread).
 * Extracts symbols, infers types, and provides context-aware completions.
 *
 * Architecture:
 *   Monaco → postMessage(change) → Worker → tree-sitter parse → symbol index
 *   Monaco → postMessage(completion request) → Worker → completion engine → response
 *
 * The worker maintains:
 *   - A tree-sitter Parser with incremental edit support
 *   - A SymbolIndex (structs, enums, functions, impls, variables)
 *   - A TypeResolver (maps variable names → types → methods)
 *   - The rustdoc SDK symbol index (loaded once from /api/autocomplete/rustdoc-index)
 */

// web-tree-sitter loaded dynamically from CDN to avoid bundler issues
// (the npm package imports Node.js modules like fs/promises, module)
type Node = any;
type Tree = any;
let Parser: any;
let Language: any;

// ── Types ─────────────────────────────────────────────────────────────

export interface SymbolEntry {
  name: string;
  kind: "struct" | "enum" | "function" | "trait" | "impl" | "variable" | "constant" | "type_alias" | "module" | "macro";
  type?: string;           // inferred type for variables (e.g. "Env", "String")
  detail?: string;         // signature (e.g. "fn hello(env: Env) -> String")
  docs?: string;
  methods?: string[];      // for structs/impls: list of method names
  fields?: { name: string; type: string }[]; // for structs: field declarations
  line: number;
}

export interface CompletionRequest {
  type: "completion";
  source: string;
  position: { line: number; column: number };  // 0-based
}

export interface CompletionResponse {
  type: "completion";
  suggestions: Array<{
    label: string;
    kind: number;           // Monaco CompletionItemKind
    detail?: string;
    docs?: string;
    insertText?: string;
  }>;
}

export interface ParseRequest {
  type: "parse";
  source: string;
}

export interface ParseResponse {
  type: "parsed";
  symbols: SymbolEntry[];
}

export type WorkerRequest = CompletionRequest | ParseRequest;
export type WorkerResponse = CompletionResponse | ParseResponse;

// ── Symbol Index ──────────────────────────────────────────────────────

class SymbolIndex {
  symbols: Map<string, SymbolEntry> = new Map();
  // Map from type name → methods (from impl blocks)
  implMethods: Map<string, SymbolEntry[]> = new Map();
  // Map from variable name → inferred type
  variableTypes: Map<string, string> = new Map();

  clear() {
    this.symbols.clear();
    this.implMethods.clear();
    this.variableTypes.clear();
  }

  add(entry: SymbolEntry) {
    this.symbols.set(entry.name, entry);
  }

  addImpl(typeName: string, method: SymbolEntry) {
    if (!this.implMethods.has(typeName)) {
      this.implMethods.set(typeName, []);
    }
    this.implMethods.get(typeName)!.push(method);
  }

  getMethodsForType(typeName: string): SymbolEntry[] {
    return this.implMethods.get(typeName) ?? [];
  }

  getVariableType(varName: string): string | undefined {
    return this.variableTypes.get(varName);
  }
}

// ── Tree-sitter Analyzer ──────────────────────────────────────────────

let parser: any | null = null;
let tree: Tree | null = null;
let currentSource = "";
const index = new SymbolIndex();

// SDK symbols from rustdoc (loaded once)
let sdkSymbols: Array<{ name: string; kind: string; detail?: string; docs?: string }> = [];

// ── Monaco CompletionItemKind constants (mirrored from Monaco) ────────
const CompletionItemKind = {
  Function: 2, Struct: 22, Enum: 13, Interface: 8, Constant: 21,
  TypeParameter: 25, Module: 9, Keyword: 14, Snippet: 4,
  Text: 18, Variable: 4, Field: 5, Class: 6,
};

const KIND_MAP: Record<string, number> = {
  function: CompletionItemKind.Function,
  struct: CompletionItemKind.Struct,
  enum: CompletionItemKind.Enum,
  trait: CompletionItemKind.Interface,
  constant: CompletionItemKind.Constant,
  type_alias: CompletionItemKind.TypeParameter,
  module: CompletionItemKind.Module,
  macro: CompletionItemKind.Function,
  variable: CompletionItemKind.Variable,
};

// ── Initialize tree-sitter ────────────────────────────────────────────

async function initParser() {
  if (parser) return;
  // Load web-tree-sitter from CDN (avoids Node.js module bundling issues)
  // @ts-ignore - CDN import
  const mod = await import("https://esm.sh/web-tree-sitter@0.25.0");
  Parser = mod.Parser || mod.default?.Parser || mod.default;
  Language = mod.Language || mod.default?.Language || mod.default;
  await Parser.init({
    locateFile: () => "/tree-sitter/web-tree-sitter.wasm",
  });
  const Rust = await Language.load("/tree-sitter/tree-sitter-rust.wasm");
  parser = new Parser();
  parser.setLanguage(Rust);
  console.log("[worker] tree-sitter Rust parser initialized");
}

// ── Load SDK symbols ──────────────────────────────────────────────────

async function loadSdkSymbols() {
  try {
    const res = await fetch("/api/autocomplete/rustdoc-index?deps=true");
    if (!res.ok) return;
    const data = await res.json();
    sdkSymbols = data.symbols ?? [];
    console.log(`[worker] loaded ${sdkSymbols.length} SDK symbols`);
  } catch (err) {
    console.warn("[worker] failed to load SDK symbols:", err);
  }
}

// ── Parse source + build symbol index ─────────────────────────────────

function parseAndIndex(source: string) {
  if (!parser) return;
  currentSource = source;
  index.clear();

  // Full reparse (incremental edit support can be added later)
  tree = parser.parse(source);

  if (!tree) return;

  const root = tree.rootNode;
  extractSymbols(root);

  // After extracting symbols, infer variable types from assignments + function params
  inferVariableTypes(root);
}

function extractSymbols(node: Node) {
  for (const child of node.children) {
    const type = child.type;

    if (type === "struct_item") {
      extractStruct(child);
    } else if (type === "enum_item") {
      extractEnum(child);
    } else if (type === "function_item" || type === "function_signature_item") {
      extractFunction(child);
    } else if (type === "impl_item") {
      extractImpl(child);
    } else if (type === "trait_item") {
      extractTrait(child);
    } else if (type === "const_item") {
      extractConst(child);
    } else if (type === "type_item") {
      extractTypeAlias(child);
    } else if (type === "use_declaration") {
      extractUse(child);
    } else if (type === "let_declaration") {
      extractLet(child);
    }
  }
}

function extractStruct(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  const fields: { name: string; type: string }[] = [];

  // Find field declarations
  const fieldList = node.childForFieldName("body");
  if (fieldList) {
    for (const field of fieldList.children) {
      if (field.type === "field_declaration") {
        const fieldName = field.childForFieldName("name")?.text ?? "?";
        const fieldType = field.childForFieldName("type")?.text ?? "?";
        fields.push({ name: fieldName, type: fieldType });
      }
    }
  }

  index.add({
    name,
    kind: "struct",
    detail: `struct ${name}`,
    fields,
    line: node.startPosition.row,
  });
}

function extractEnum(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;

  index.add({
    name,
    kind: "enum",
    detail: `enum ${name}`,
    line: node.startPosition.row,
  });
}

function extractFunction(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;

  // Build signature: fn name(params) -> ReturnType
  const params = node.childForFieldName("parameters")?.text ?? "()";
  const retType = node.childForFieldName("return_type")?.text ?? "";
  const isPub = node.children.some(c => c.type === "visibility_modifier");
  const prefix = isPub ? "pub " : "";

  const detail = `${prefix}fn ${name}${params}${retType}`;

  index.add({
    name,
    kind: "function",
    detail,
    line: node.startPosition.row,
  });

  // Check if it's a method (inside impl) — extract self type
  // This is handled in extractImpl
}

function extractImpl(node: Node) {
  // impl Type { ... } or impl Trait for Type { ... }
  const typeNode = node.childForFieldName("type");
  const traitNode = node.childForFieldName("trait");
  const typeName = typeNode?.text ?? "";

  if (!typeName) return;

  // Extract methods from the impl body
  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.children) {
      if (child.type === "function_item" || child.type === "function_signature_item") {
        const methodName = child.childForFieldName("name")?.text;
        if (!methodName) continue;

        const params = child.childForFieldName("parameters")?.text ?? "()";
        const retType = child.childForFieldName("return_type")?.text ?? "";
        const isPub = child.children.some(c => c.type === "visibility_modifier");
        const prefix = isPub ? "pub " : "";

        index.addImpl(typeName, {
          name: methodName,
          kind: "function",
          detail: `${prefix}fn ${methodName}${params}${retType}`,
          line: child.startPosition.row,
        });
      }
    }
  }
}

function extractTrait(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;

  index.add({
    name,
    kind: "trait",
    detail: `trait ${name}`,
    line: node.startPosition.row,
  });
}

function extractConst(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  const type = node.childForFieldName("type")?.text;

  index.add({
    name,
    kind: "constant",
    detail: type ? `const ${name}: ${type}` : `const ${name}`,
    line: node.startPosition.row,
  });
}

function extractTypeAlias(node: Node) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;

  index.add({
    name,
    kind: "type_alias",
    detail: `type ${name}`,
    line: node.startPosition.row,
  });
}

function extractUse(node: Node) {
  const arg = node.childForFieldName("argument");
  if (!arg) return;
  const path = arg.text;
  const parts = path.split("::");
  const lastPart = parts[parts.length - 1];

  index.add({
    name: lastPart,
    kind: "module",
    detail: `use ${path}`,
    line: node.startPosition.row,
  });
}

function extractLet(node: Node) {
  const pattern = node.childForFieldName("pattern");
  if (!pattern) return;
  const varName = pattern.text;

  // Check for explicit type annotation: let x: Type = ...
  const typeAnn = node.children.find(c => c.type === "type_annotation");
  if (typeAnn) {
    const type = typeAnn.childForFieldName("type")?.text;
    if (type) {
      index.variableTypes.set(varName, type);
      return;
    }
  }

  // Try to infer type from the initializer
  const value = node.childForFieldName("value");
  if (value) {
    const inferredType = inferTypeFromExpr(value);
    if (inferredType) {
      index.variableTypes.set(varName, inferredType);
    }
  }
}

function inferTypeFromExpr(node: Node): string | null {
  if (!node) return null;
  const type = node.type;

  // String::from_str(&env, "...") → String
  if (type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func) {
      const funcText = func.text;
      // Type::method(...) → Type
      const match = funcText.match(/^([A-Z][A-Za-z0-9_]*)::/);
      if (match) return match[1];
    }
  }

  // Env::default() → Env
  if (type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func?.text === "Env::default") return "Env";
  }

  // Identifier → look up its type
  if (type === "identifier") {
    return index.variableTypes.get(node.text) ?? null;
  }

  // Field expression: foo.bar → try to resolve foo's type
  if (type === "field_expression") {
    const value = node.childForFieldName("value");
    const field = node.childForFieldName("field");
    if (value && field) {
      const valueType = inferTypeFromExpr(value);
      if (valueType) {
        // Check if it's a known struct with fields
        const sym = index.symbols.get(valueType);
        if (sym?.fields) {
          const fieldInfo = sym.fields.find(f => f.name === field.text);
          if (fieldInfo) return fieldInfo.type;
        }
      }
    }
  }

  return null;
}

function inferVariableTypes(node: Node) {
  // Walk the tree and process let declarations + function params
  const cursor = node.walk();
  const visit = (n: Node) => {
    if (n.type === "let_declaration") {
      extractLet(n);
    }
    // Also handle function parameters with type annotations
    if (n.type === "parameter") {
      const pattern = n.childForFieldName("pattern");
      const typeAnn = n.children.find(c => c.type === "type_annotation");
      if (pattern && typeAnn) {
        const type = typeAnn.childForFieldName("type")?.text;
        if (type) {
          index.variableTypes.set(pattern.text, type);
        }
      }
    }
    for (const child of n.children) {
      visit(child);
    }
  };
  visit(node);
}

// ── Completion Engine ─────────────────────────────────────────────────

function getCompletions(source: string, position: { line: number; column: number }): CompletionResponse {
  // Get the line text up to the cursor position
  const lines = source.split("\n");
  const lineNum = position.line;
  const lineText = lines[lineNum] ?? "";
  const beforeCursor = lineText.substring(0, position.column);

  const trimmed = beforeCursor.trim();
  const isAfterDot = beforeCursor.endsWith(".");
  const isAfterDoubleColon = beforeCursor.endsWith("::");
  const isAfterUse = trimmed.startsWith("use ") || trimmed === "use";

  const suggestions: CompletionResponse["suggestions"] = [];
  const seenLabels = new Set<string>();

  const add = (label: string, kind: number, detail?: string, docs?: string, insertText?: string) => {
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    suggestions.push({ label, kind, detail, docs, insertText });
  };

  // ── After `.` → method completion (type-aware) ──────────────────────
  if (isAfterDot) {
    // Find the expression before the dot
    const beforeDot = beforeCursor.slice(0, -1).trim();
    // Try to resolve the type of the expression
    const varType = index.getVariableType(beforeDot);

    if (varType) {
      // Show methods from impl blocks for this type
      const methods = index.getMethodsForType(varType);
      for (const m of methods) {
        add(m.name, CompletionItemKind.Function, m.detail, m.docs);
      }

      // Also show SDK methods for known SDK types (Env, String, Vec, Map, etc.)
      for (const s of sdkSymbols) {
        if (s.kind === "function" || s.kind === "macro") {
          add(s.name, KIND_MAP[s.kind] ?? CompletionItemKind.Function, s.detail, s.docs);
        }
      }
    } else {
      // Can't resolve type — show all functions from the symbol index + SDK
      for (const [, sym] of index.symbols) {
        if (sym.kind === "function") {
          add(sym.name, CompletionItemKind.Function, sym.detail, sym.docs);
        }
      }
      for (const s of sdkSymbols) {
        if (s.kind === "function" || s.kind === "macro") {
          add(s.name, KIND_MAP[s.kind] ?? CompletionItemKind.Function, s.detail, s.docs);
        }
      }
    }
  }
  // ── After `::` → associated items ───────────────────────────────────
  else if (isAfterDoubleColon) {
    // Extract the type name before ::
    const beforeColons = beforeCursor.slice(0, -2);
    const match = beforeColons.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    const typeName = match?.[1];

    if (typeName) {
      // Show methods from impl blocks for this type
      const methods = index.getMethodsForType(typeName);
      for (const m of methods) {
        add(m.name, CompletionItemKind.Function, m.detail, m.docs);
      }

      // Show fields if it's a struct
      const sym = index.symbols.get(typeName);
      if (sym?.fields) {
        for (const f of sym.fields) {
          add(f.name, CompletionItemKind.Field, `${f.name}: ${f.type}`);
        }
      }
    }

    // Always show all SDK symbols after ::
    for (const s of sdkSymbols) {
      add(s.name, KIND_MAP[s.kind] ?? CompletionItemKind.Text, s.detail, s.docs);
    }
  }
  // ── After `use ` → modules + types ──────────────────────────────────
  else if (isAfterUse) {
    for (const s of sdkSymbols) {
      add(s.name, KIND_MAP[s.kind] ?? CompletionItemKind.Text, s.detail, s.docs);
    }
    for (const [, sym] of index.symbols) {
      if (sym.kind === "module") {
        add(sym.name, CompletionItemKind.Module, sym.detail, sym.docs);
      }
    }
  }
  // ── Normal context → all symbols ────────────────────────────────────
  else {
    // SDK types + constants + modules (skip functions in global context)
    for (const s of sdkSymbols) {
      if (s.kind !== "function" && s.kind !== "macro") {
        add(s.name, KIND_MAP[s.kind] ?? CompletionItemKind.Text, s.detail, s.docs);
      }
    }

    // Local symbols from the project
    for (const [, sym] of index.symbols) {
      if (sym.kind === "module" && !isAfterUse) continue;
      add(sym.name, KIND_MAP[sym.kind] ?? CompletionItemKind.Text, sym.detail, sym.docs);
    }
  }

  return { type: "completion", suggestions };
}

// ── Message Handler ───────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "parse") {
    await initParser();
    if (sdkSymbols.length === 0) {
      loadSdkSymbols(); // fire and forget
    }
    parseAndIndex(msg.source);

    const symbols = Array.from(index.symbols.values());
    const response: ParseResponse = { type: "parsed", symbols };
    (self as unknown as Worker).postMessage(response);
  } else if (msg.type === "completion") {
    // Re-parse if source changed
    if (msg.source !== currentSource) {
      await initParser();
      parseAndIndex(msg.source);
    }

    const response = getCompletions(msg.source, msg.position);
    (self as unknown as Worker).postMessage(response);
  }
};
