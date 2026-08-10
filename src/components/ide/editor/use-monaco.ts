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
 * Hook that registers a context-aware autocomplete provider.
 *
 * Soroban contracts use #![no_std], so we only index soroban_sdk (which
 * provides its own String, Vec, Map, etc.). No std/core/alloc needed.
 *
 * Three layers of completion:
 *   1. Rustdoc symbols (soroban-sdk only) — fetched once from
 *      /api/autocomplete/rustdoc-index, cached in memory (~12 KB gzipped)
 *   2. Source-parsed symbols from the autocomplete store (user's own .rs files)
 *   3. Built-in Soroban snippets + Rust keywords
 *
 * Context-aware:
 *   - After `.` → method/member completion (functions from the SDK)
 *   - After `::` or `use ` → module + type completion
 *   - Otherwise → all SDK symbols + keywords + snippets
 */
export function useAutocompleteProvider() {
  const items = useAutocompleteStore((s) => s.items);
  const ready = useAutocompleteStore((s) => s.ready);
  const providerRef = useRef<{ dispose: () => void } | null>(null);
  const rustdocRef = useRef<unknown[] | null>(null);
  const itemsRef = useRef(items);

  // Keep itemsRef in sync (so the provider closure always sees latest items
  // without needing to re-register the provider)
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Fetch rustdoc index once (cached in ref)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/autocomplete/rustdoc-index?deps=true");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const symbols = data.symbols ?? [];
        rustdocRef.current = symbols;
        console.log(
          `[autocomplete] loaded rustdoc index: ${symbols.length} symbols`,
          data.crates ? `(${data.crates.map((c: { name: string }) => c.name).join(", ")})` : ""
        );
      } catch (err) {
        console.warn("[autocomplete] failed to load rustdoc index:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Register the completion provider ONCE (not on every items change)
  useEffect(() => {
    let disposed = false;

    (async () => {
      const monacoModule = await import("monaco-editor");
      const monaco = (monacoModule.default ?? monacoModule) as typeof Monaco;
      if (disposed || !monaco?.languages) return;

      // Dispose previous provider (shouldn't exist, but safety)
      if (providerRef.current) {
        providerRef.current.dispose();
        providerRef.current = null;
      }

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

      // Register the context-aware provider ONCE.
      // Uses refs (rustdocRef, itemsRef) so it always sees the latest data
      // without needing to re-register.
      const provider = monaco.languages.registerCompletionItemProvider("rust", {
        triggerCharacters: [".", ":", "u", "p", "f", "s", "e", "m", "c", "t", "v", "a", "b"],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

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

          const suggestions: Monaco.languages.CompletionItem[] = [];
          const seenLabels = new Set<string>();

          const add = (
            label: string,
            kind: number,
            detail: string | undefined,
            docs: string | undefined,
            insertText: string | undefined,
            sortText: string
          ) => {
            if (seenLabels.has(label)) return;
            seenLabels.add(label);
            suggestions.push({
              label,
              kind,
              detail,
              documentation: docs ? { value: docs } : undefined,
              insertText: insertText || label,
              insertTextRules: insertText && /\$\{/.test(insertText)
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
              sortText,
            });
          };

          // ── Layer 1: Rustdoc symbols (soroban-sdk + deps) ──────────
          // Read from ref so we always get the latest (even if loaded after registration)
          const sdkSymbols = rustdocRef.current;
          if (sdkSymbols) {
            for (const sym of sdkSymbols) {
              const s = sym as { name: string; kind: string; detail?: string; docs?: string };

              if (isAfterDot) {
                if (s.kind === "function" || s.kind === "macro") {
                  add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Function, s.detail, s.docs, undefined, "1");
                }
              } else if (isAfterDoubleColon || isAfterUse) {
                add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
              } else {
                if (s.kind === "function" || s.kind === "macro") continue;
                add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
              }
            }
          }

          // ── Layer 2: Source-parsed symbols (from autocomplete store) ─
          // Read from ref so we always get the latest items
          const currentItems = itemsRef.current;
          if (!isAfterDot) {
            for (const item of currentItems) {
              if (item.kind === "module" && !isAfterDoubleColon && !isAfterUse) continue;
              add(
                item.label,
                kindMap[item.kind] ?? monaco.languages.CompletionItemKind.Text,
                item.detail,
                item.documentation,
                item.insertText || item.label,
                item.kind === "snippet" ? "0" : item.kind === "function" ? "1" : "2"
              );
            }
          }

          return { suggestions };
        },
      });

      providerRef.current = provider;
      console.log("[autocomplete] completion provider registered for 'rust' language");
    })();

    return () => {
      disposed = true;
      if (providerRef.current) {
        providerRef.current.dispose();
        providerRef.current = null;
      }
    };
  }, []); // ← empty deps: register ONCE

  return null;
}
