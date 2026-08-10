"use client";

import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { useThemeStore } from "@/stores/theme-store";
import { buildMonacoTheme } from "@/lib/themes/mappers";
import { useAutocompleteStore, type CompletionItem } from "@/stores/autocomplete-store";

// Monaco must be loaded client-side only via dynamic import in the consumer.
// This hook sets up: theme registration, Rust/Soroban language config, dispose.

let monacoLoaded = false;

export function useMonacoTheme() {
  const themeId = useThemeStore((s) => s.themeId);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const monaco = (await import("monaco-editor")).default as typeof Monaco;
      if (cancelled) return;

      if (!monacoLoaded) {
        registerSorobanLanguage(monaco);
        monacoLoaded = true;
      }

      const theme = getActiveTheme();
      monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
      monaco.editor.setTheme(theme.id);
    })();

    return () => {
      cancelled = true;
    };
  }, [themeId, getActiveTheme]);
}

/**
 * Register a custom Rust/Soroban language configuration on top of Monaco's
 * built-in Rust support. Adds soroban-sdk-specific tokens, hover docs, and
 * snippets.
 *
 * In a real production build this would be backed by a full LSP — for now
 * we provide tokenizer rules + keywords + snippets for a great editing feel.
 */
export function registerSorobanLanguage(monaco: typeof Monaco) {
  // We use the standard "rust" language id (not a custom "soroban" id) so
  // rust-analyzer LSP matches the document and provides completions.
  // We override the Monarch tokenizer + language config to add Soroban-specific
  // keywords (contract, contractimpl, etc.) on top of the Rust syntax.
  //
  // NOTE: Monaco may not have a built-in "rust" language registered in all
  // setups, so we register it first (idempotent — register is a no-op if
  // the language already exists).
  monaco.languages.register({ id: "rust", extensions: [".rs"], aliases: ["Rust", "soroban"] });

  // Apply the Soroban-enhanced Monarch tokenizer to the "rust" language.
  monaco.languages.setMonarchTokensProvider("rust", {
    defaultToken: "",
    tokenPostfix: "",
    keywords: [
      "as", "async", "await", "break", "const", "continue", "crate", "dyn",
      "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in",
      "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
      "self", "Self", "static", "struct", "super", "trait", "true", "type",
      "unsafe", "use", "where", "while", "abstract", "become", "box", "do",
      "final", "macro", "override", "priv", "typeof", "unsized", "virtual",
      "yield", "try",
    ],
    typeKeywords: [
      "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128",
      "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result",
      "Env", "Address", "Bytes", "BytesN", "Map", "Symbol", "Vec",
    ],
    sorobanKeywords: [
      "contract", "contractimpl", "contracttype", "contracterror", "contractclient",
      "soroban_sdk",
    ],
    operators: [
      "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "++",
      "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", ">>>", "+=", "-=",
      "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>=", "=>", "->", "::",
    ],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    tokenizer: {
      root: [
        // Attributes & macros
        [/#\[/, { token: "attribute", next: "@attribute" }],
        [/#![a-zA-Z_]\w*/, "attribute"],
        [/[a-zA-Z_]\w*!/, "macro"],

        // Comments
        [/\/\/\/.*/, "comment.doc"],
        [/\/\/.*/, "comment"],
        [/\/\*/, "comment", "@comment"],

        // Strings
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],
        [/b"/, "string", "@string"],
        [/r#+"/, "string", "@rawstring"],

        // Numbers
        [/\d[\d_]*(\.[\d_]+)?([eE][+-]?[\d_]+)?[fFuUiI]{0,2}/, "number"],
        [/0[xX][0-9a-fA-F_]+/, "number"],
        [/0[bB][01_]+/, "number"],

        // Soroban macros — contract, contractimpl, etc.
        [/#\[contract\w*\]/, "attribute"],
        [/contract\b/, "keyword"],
        [/contractimpl\b/, "keyword"],
        [/contracttype\b/, "keyword"],
        [/contracterror\b/, "keyword"],
        [/contractclient\b/, "keyword"],

        // Identifiers / keywords
        [
          /[a-z_]\w*/i,
          {
            cases: {
              "@typeKeywords": "type",
              "@sorobanKeywords": "macro",
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],

        // Whitespace
        { include: "@whitespace" },

        // Delimiters
        [/[{}()\[\]]/, "@brackets"],
        [/[<>](?!@symbols)/, "@brackets"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/[,;.]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],
      rawstring: [
        [/[^"]+/, "string"],
        [/"#+/, "string", "@pop"],
        [/"/, "string"],
      ],
      attribute: [
        [/[^\]]+/, "attribute"],
        [/\]/, { token: "attribute", next: "@pop" }],
      ],
      whitespace: [
        [/[ \t\r\n]+/, ""],
      ],
    },
  });

  // Language configuration — brackets, autoclosing, etc.
  monaco.languages.setLanguageConfiguration("rust", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    onEnterRules: [
      {
        // Continue line comments
        beforeText: /^\s*\/\/.*/,
        action: { indentAction: monaco.languages.IndentAction.None, insertText: "// " },
      },
      {
        // Indent inside braces
        beforeText: /^\s*\{[^}]*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
    folding: {
      markers: {
        start: /^\s*\/\/\s*#?region\b/,
        end: /^\s*\/\/\s*#?endregion\b/,
      },
    },
  });

  // Snippets for common Soroban patterns
  monaco.languages.registerCompletionItemProvider("rust", {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: Monaco.languages.CompletionItem[] = [
        {
          label: "#[contract]",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: "#[contract]\npub struct ${1:ContractName};",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Define a Soroban contract struct",
          range,
        },
        {
          label: "#[contractimpl]",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText:
            "#[contractimpl]\nimpl ${1:ContractName} {\n    pub fn ${2:method}(env: Env) -> ${3:ReturnType} {\n        ${4:todo!()}\n    }\n}",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Implement a Soroban contract",
          range,
        },
        {
          label: "#[contracttype]",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: "#[contracttype]\npub enum ${1:EnumName} {\n    ${2:Variant},\n}",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Define a Soroban contract type (enum)",
          range,
        },
        {
          label: "pub fn with env",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText:
            "pub fn ${1:method}(env: Env, ${2:arg}: ${3:ArgType}) -> ${4:ReturnType} {\n    ${5:todo!()}\n}",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Public Soroban contract method",
          range,
        },
        {
          label: "env.storage().instance().set",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText:
            "env.storage().instance().set(&${1:Key}, &${2:value});",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Set a value in instance storage",
          range,
        },
        {
          label: "env.storage().instance().get",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText:
            "env.storage().instance().get(&${1:Key}).unwrap_or_else(|| ${2:default})",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Get a value from instance storage",
          range,
        },
        {
          label: "require_auth",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: "${1:address}.require_auth();",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Require authentication from an address",
          range,
        },
        {
          label: "test (soroban)",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText:
            "#[test]\nfn test_${1:name}() {\n    let env = Env::default();\n    let contract_id = env.register(${2:Contract}, ());\n    let client = ${2:Contract}Client::new(&env, &contract_id);\n\n    ${3:// assertions}\n}",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: "Soroban test scaffold",
          range,
        },
      ];

      return { suggestions };
    },
  });

  // Hover docs for soroban-sdk types
  monaco.languages.registerHoverProvider("rust", {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const wordText = word.word;

      const docs: Record<string, string> = {
        Env: "**Env** — Soroban environment handle.\n\nProvides access to storage, invocation, events, and the current caller.",
        Address: "**Address** — A 32-byte Soroban account or contract address.\n\nUse `.require_auth()` to enforce authorization.",
        contract: "**#[contract]** — Marks a struct as a Soroban contract.\n\nThe struct itself holds no fields; logic lives in `#[contractimpl]` blocks.",
        contractimpl: "**#[contractimpl]** — Marks an `impl` block as the contract's exported methods.\n\nEvery `pub fn` here becomes a callable contract function.",
        require_auth: "**require_auth** — Verifies the caller authorized this invocation.\n\nAlways call on any `Address` passed as a function argument to prevent unauthorized actions.",
      };

      const doc = docs[wordText];
      if (!doc) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [{ value: doc }],
      };
    },
  });
}


/**
 * Register the context-aware autocomplete provider on the given Monaco instance.
 *
 * CRITICAL: This must use the SAME Monaco instance as the editor (from the
 * onMount callback). @monaco-editor/react loads Monaco from CDN, while
 * import("monaco-editor") loads from node_modules — they're different instances
 * and don't share language providers.
 *
 * Returns a disposable (call .dispose() to remove the provider).
 */

// Module-level refs — shared across all provider registrations.
let rustdocSymbols: unknown[] | null = null;
let rustdocFetchStarted = false;

function ensureRustdocLoaded() {
  if (rustdocFetchStarted) return;
  rustdocFetchStarted = true;

  fetch("/api/autocomplete/rustdoc-index?deps=true")
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      if (data?.symbols) {
        rustdocSymbols = data.symbols;
        const count = (rustdocSymbols as unknown[]).length;
        console.log(
          `[autocomplete] loaded rustdoc index: ${count} symbols`,
          data.crates ? `(${data.crates.map((c: { name: string }) => c.name).join(", ")})` : ""
        );
      }
    })
    .catch((err) => {
      console.warn("[autocomplete] failed to load rustdoc index:", err);
      rustdocFetchStarted = false;
    });
}

export function registerAutocompleteProvider(monaco: typeof Monaco): { dispose: () => void } {
  ensureRustdocLoaded();

  let currentItems: CompletionItem[] = useAutocompleteStore.getState().items;
  const unsubscribe = useAutocompleteStore.subscribe((state) => {
    currentItems = state.items;
  });

  const kindMap: Record<string, number> = {
    function: monaco.languages.CompletionItemKind.Function,
    struct: monaco.languages.CompletionItemKind.Struct,
    enum: monaco.languages.CompletionItemKind.Enum,
    trait: monaco.languages.CompletionItemKind.Interface,
    constant: monaco.languages.CompletionItemKind.Constant,
    type_alias: monaco.languages.CompletionItemKind.TypeParameter,
    typeAlias: monaco.languages.CompletionItemKind.TypeParameter,
    module: monaco.languages.CompletionItemKind.Module,
    keyword: monaco.languages.CompletionItemKind.Keyword,
    snippet: monaco.languages.CompletionItemKind.Snippet,
    static: monaco.languages.CompletionItemKind.Enum,
    macro: monaco.languages.CompletionItemKind.Function,
  };

  const provider = monaco.languages.registerCompletionItemProvider("rust", {
    triggerCharacters: [".", ":", "u", "p", "f", "s", "e", "m", "c", "t", "v", "a", "b"],
    provideCompletionItems: (model, position) => {
      const lineUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const trimmed = lineUntilPosition.trim();
      const isAfterDot = lineUntilPosition.endsWith(".");
      const isAfterDoubleColon = lineUntilPosition.endsWith("::");
      const isAfterUse = trimmed.startsWith("use ") || trimmed === "use";

      // When after `::` or `.`, the word at cursor is empty (Monaco doesn't
      // treat : or . as word characters). Use the cursor position directly
      // as the range so Monaco shows the completion widget.
      let range: Monaco.IRange;
      if (isAfterDoubleColon || isAfterDot) {
        // Empty range at cursor position — Monaco will show all suggestions
        // and filter as the user types
        range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column,
        };
      } else {
        const word = model.getWordUntilPosition(position);
        range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
      }

      // Detect the type before `::` for context-aware completion
      // e.g. "String::" → typeName = "String"
      let typeName: string | null = null;
      if (isAfterDoubleColon) {
        const beforeColons = lineUntilPosition.slice(0, -2);
        const match = beforeColons.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        if (match) {
          typeName = match[1];
        }
      }

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const seenLabels = new Set<string>();

      const add = (label: string, kind: number, detail: string | undefined, docs: string | undefined, insertText: string | undefined, sortText: string) => {
        if (seenLabels.has(label)) return;
        seenLabels.add(label);
        suggestions.push({
          label, kind, detail,
          documentation: docs ? { value: docs } : undefined,
          insertText: insertText || label,
          insertTextRules: insertText && /\$\{/.test(insertText) ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range, sortText,
        });
      };

      // Layer 1: Rustdoc symbols
      if (rustdocSymbols) {
        for (const sym of rustdocSymbols) {
          const s = sym as { name: string; kind: string; detail?: string; docs?: string };
          if (isAfterDot) {
            // After `.` → show functions + macros (method completion)
            if (s.kind === "function" || s.kind === "macro") {
              add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Function, s.detail, s.docs, undefined, "1");
            }
          } else if (isAfterDoubleColon) {
            // After `Type::` → show ALL symbols (associated functions, constants, etc.)
            // Don't filter by typeName — just show everything so the user can pick
            add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
          } else if (isAfterUse) {
            // After `use ` → show modules + types
            add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
          } else {
            // Normal context → show types + constants + modules (skip functions)
            if (s.kind === "function" || s.kind === "macro") continue;
            add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
          }
        }
      }

      // Layer 2: Source-parsed symbols (skip when after . or ::)
      if (!isAfterDot && !isAfterDoubleColon) {
        for (const item of currentItems) {
          if (item.kind === "module" && !isAfterUse) continue;
          add(item.label, kindMap[item.kind] ?? monaco.languages.CompletionItemKind.Text, item.detail, item.documentation, item.insertText || item.label, item.kind === "snippet" ? "0" : item.kind === "function" ? "1" : "2");
        }
      }

      return { suggestions };
    },
  });

  console.log("[autocomplete] completion provider registered for 'rust' language");

  return {
    dispose: () => {
      provider.dispose();
      unsubscribe();
    },
  };
}

// ── Tree-sitter Web Worker autocomplete ────────────────────────────────

let analyzerWorker: Worker | null = null;
let workerReady = false;

/** Get or create the analyzer Web Worker (singleton). */
function getAnalyzerWorker(): Worker | null {
  if (analyzerWorker || typeof window === "undefined") return analyzerWorker;
  try {
    analyzerWorker = new Worker(
      new URL("../../../lib/autocomplete/analyzer.worker.ts", import.meta.url)
    );
    analyzerWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "parsed") {
        console.log(`[autocomplete] worker parsed: ${msg.symbols.length} symbols`);
      }
    };
    analyzerWorker.onerror = (err) => {
      console.warn("[autocomplete] worker error:", err);
    };
    workerReady = true;
    console.log("[autocomplete] tree-sitter worker created");
  } catch (err) {
    console.warn("[autocomplete] failed to create worker:", err);
  }
  return analyzerWorker;
}

/**
 * Request completions from the tree-sitter worker (async).
 * Returns a promise that resolves with the suggestions.
 */
function requestCompletionsFromWorker(
  source: string,
  position: { line: number; column: number }
): Promise<Array<{ label: string; kind: number; detail?: string; docs?: string; insertText?: string }>> {
  return new Promise((resolve) => {
    const worker = getAnalyzerWorker();
    if (!worker) {
      resolve([]);
      return;
    }

    const timeout = setTimeout(() => resolve([]), 2000);

    const handler = (e: MessageEvent) => {
      if (e.data.type === "completion") {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve(e.data.suggestions);
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "completion", source, position });
  });
}

/**
 * Register a tree-sitter powered autocomplete provider on the given Monaco instance.
 * Uses a Web Worker for parsing (off the UI thread).
 * Falls back to the simple provider if the worker fails.
 */
export function registerTreeSitterProvider(monaco: typeof Monaco): { dispose: () => void } {
  // Pre-load the worker
  getAnalyzerWorker();

  // Also keep the simple provider as fallback
  const fallback = registerAutocompleteProvider(monaco);

  let currentItems: CompletionItem[] = useAutocompleteStore.getState().items;
  const unsubscribe = useAutocompleteStore.subscribe((state) => {
    currentItems = state.items;
    // Send updated source to worker for re-parsing
    // (the worker will re-parse on next completion request anyway)
  });
  currentItems = useAutocompleteStore.getState().items;

  const kindMap: Record<string, number> = {
    function: monaco.languages.CompletionItemKind.Function,
    struct: monaco.languages.CompletionItemKind.Struct,
    enum: monaco.languages.CompletionItemKind.Enum,
    trait: monaco.languages.CompletionItemKind.Interface,
    constant: monaco.languages.CompletionItemKind.Constant,
    type_alias: monaco.languages.CompletionItemKind.TypeParameter,
    typeAlias: monaco.languages.CompletionItemKind.TypeParameter,
    module: monaco.languages.CompletionItemKind.Module,
    keyword: monaco.languages.CompletionItemKind.Keyword,
    snippet: monaco.languages.CompletionItemKind.Snippet,
    static: monaco.languages.CompletionItemKind.Enum,
    macro: monaco.languages.CompletionItemKind.Function,
  };

  const provider = monaco.languages.registerCompletionItemProvider("rust", {
    triggerCharacters: [".", ":", "u", "p", "f", "s", "e", "m", "c", "t", "v", "a", "b"],
    // Use async completion — Monaco supports returning a Promise
    provideCompletionItems: async (model, position) => {
      const source = model.getValue();
      const workerPosition = {
        line: position.lineNumber - 1,  // Monaco is 1-based, tree-sitter is 0-based
        column: position.column - 1,
      };

      // Request completions from the tree-sitter worker
      const workerSuggestions = await requestCompletionsFromWorker(source, workerPosition);

      // If worker returned suggestions, use them
      if (workerSuggestions.length > 0) {
        const word = model.getWordUntilPosition(position);
        const lineUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const isAfterDoubleColon = lineUntilPosition.endsWith("::");
        const isAfterDot = lineUntilPosition.endsWith(".");

        let range: Monaco.IRange;
        if (isAfterDoubleColon || isAfterDot) {
          range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column,
          };
        } else {
          range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
        }

        const seenLabels = new Set<string>();
        const suggestions: Monaco.languages.CompletionItem[] = [];

        // Add worker suggestions first (highest priority — they're type-aware)
        for (const s of workerSuggestions) {
          if (seenLabels.has(s.label)) continue;
          seenLabels.add(s.label);
          suggestions.push({
            label: s.label,
            kind: s.kind,
            detail: s.detail,
            documentation: s.docs ? { value: s.docs } : undefined,
            insertText: s.insertText || s.label,
            range,
            sortText: "0",
          });
        }

        // Also add local snippet items (from the autocomplete store) as fallback
        const trimmed = lineUntilPosition.trim();
        const isAfterUse = trimmed.startsWith("use ") || trimmed === "use";
        if (!isAfterDot && !isAfterDoubleColon) {
          for (const item of currentItems) {
            if (item.kind === "module" && !isAfterUse) continue;
            if (seenLabels.has(item.label)) continue;
            seenLabels.add(item.label);
            suggestions.push({
              label: item.label,
              kind: kindMap[item.kind] ?? monaco.languages.CompletionItemKind.Text,
              detail: item.detail,
              documentation: item.documentation ? { value: item.documentation } : undefined,
              insertText: item.insertText || item.label,
              insertTextRules: item.insertText && /\$\{/.test(item.insertText)
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
              sortText: item.kind === "snippet" ? "0" : "2",
            });
          }
        }

        return { suggestions };
      }

      // Worker failed — return empty (the fallback provider handles it)
      return { suggestions: [] };
    },
  });

  console.log("[autocomplete] tree-sitter provider registered for 'rust' language");

  return {
    dispose: () => {
      provider.dispose();
      fallback.dispose();
      unsubscribe();
    },
  };
}

