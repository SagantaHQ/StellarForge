"use client";

import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { useThemeStore } from "@/stores/theme-store";
import { buildMonacoTheme } from "@/lib/themes/mappers";
import { useAutocompleteStore, type CompletionItem } from "@/stores/autocomplete-store";
import { buildAutoImportEdit } from "@/lib/autocomplete/auto-import";
import {
  getTypeMembers,
  getTypeCrate,
  lookupVariableType,
  clearTypeCache,
  type TypeMember,
} from "@/lib/autocomplete/type-members";

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

  // ─── Per-model request-id tracking ──────────────────────────────
  // Each completion request bumps a counter for the model. When an async
  // operation resolves, we check the counter — if it doesn't match, a
  // newer request has started and we discard the stale result.
  // (This prevents the "old suggestions appear after typing" race
  // condition that Qwen AI flagged.)
  const requestIds = new Map<string, number>();

  // ─── Short-lived completion cache ────────────────────────────────
  // Keyed by `${filePath}:${languageId}:${prefix}`. Cached for 15s so
  // rapid typing (which re-triggers the provider on every keystroke)
  // doesn't re-iterate the entire rustdoc index every time.
  const CACHE_TTL_MS = 15_000;
  const completionCache = new Map<string, { at: number; items: Monaco.languages.CompletionItem[] }>();

  let currentItems: CompletionItem[] = useAutocompleteStore.getState().items;
  const unsubscribe = useAutocompleteStore.subscribe((state) => {
    currentItems = state.items;
    // Invalidate the cache when the source-parsed items change — the cached
    // suggestions would otherwise be stale until the TTL expires.
    completionCache.clear();
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
    // Structural trigger characters only — NOT single letters.
    // Single-letter triggers (the old `u/p/f/s/e/m/c/t/v/a/b`) caused
    // the completion widget to fire on EVERY keystroke of those letters,
    // which combined with no async + no cache made typing feel laggy.
    // Monaco already shows suggestions on identifier characters by default
    // when quickSuggestions.other === true (set in editor options).
    triggerCharacters: [".", ":", "::", "@", "#", '"', "/", "_", "-"],
    // async so we can await the cancellation token + future AI fetches
    provideCompletionItems: async (model, position, _context, token) => {
      const modelKey = model.uri.toString();
      const requestId = (requestIds.get(modelKey) ?? 0) + 1;
      requestIds.set(modelKey, requestId);

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

      const typePathMatch = lineUntilPosition.match(/([A-Za-z_][A-Za-z0-9_]*)\s*::\s*[A-Za-z0-9_]*$/);
      const typeBeforeColonsName = typePathMatch ? typePathMatch[1] : null;
      const isInTypePath = typeBeforeColonsName !== null;

      let range: Monaco.IRange;
      if (isAfterDoubleColon || isAfterDot) {
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

      // ─── Cache lookup ────────────────────────────────────────────
      // Cache key includes the file path + the prefix being completed.
      // Hit → return cached items with refreshed range (range depends on
      // cursor position, which changes per keystroke even for the same
      // prefix).
      const prefix = (lineUntilPosition.match(/[A-Za-z0-9_$.@#:"'/\\:-]+$/) ?? [""])[0];
      const cacheKey = `${model.uri.path}:rust:${prefix}`;
      const cached = completionCache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        // Refresh range on every hit — same prefix can be at a different
        // cursor position if the user moved around.
        return {
          suggestions: cached.items.map((item) => ({ ...item, range })),
        };
      }

      // ─── Compute suggestions (CPU work — sync, but cached after) ─
      const typeName = typeBeforeColonsName;
      const source = model.getValue();

      // Pre-compute the auto-import edit for the type-before-`::` ONCE
      // per request (was previously called per-suggestion inside the
      // add() helper — O(N) calls to buildAutoImportEdit per keystroke).
      let typeBeforeColonsImport: { crate: string; symbol: string; kind: string } | undefined;
      let typeBeforeColonsEdit: Monaco.languages.TextEdit[] | undefined;
      if (isInTypePath && typeName && rustdocSymbols) {
        for (const sym of rustdocSymbols) {
          const s = sym as { name: string; kind: string; module?: string };
          if (s.name === typeName && s.module && (
            s.kind === "struct" || s.kind === "enum" || s.kind === "trait" ||
            s.kind === "type_alias" || s.kind === "typeAlias" || s.kind === "module"
          )) {
            typeBeforeColonsImport = { crate: s.module, symbol: s.name, kind: s.kind };
            // Pre-compute the edit ONCE — reuse for every suggestion in this request
            const result = buildAutoImportEdit(source, typeBeforeColonsImport);
            if (result) {
              typeBeforeColonsEdit = [result.edit as Monaco.languages.TextEdit];
            }
            break;
          }
        }
      }

      // Pre-compute the auto-import edit for symbols in the "normal" context
      // (not after `.` / `::` / `use`). We can't pre-compute this because
      // each symbol has a different crate+symbol name — but we can cache
      // the per-(crate,symbol) result so we don't recompute for duplicates.
      // (The `add` helper already deduplicates by label, so this cache
      // only kicks in if the same symbol appears under different crates.)
      const autoImportCache = new Map<string, Monaco.languages.TextEdit[] | undefined>();

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const seenLabels = new Set<string>();

      const add = (
        label: string,
        kind: number,
        detail: string | undefined,
        docs: string | undefined,
        insertText: string | undefined,
        sortText: string,
        autoImport?: { crate: string; symbol: string; kind: string }
      ) => {
        if (seenLabels.has(label)) return;
        seenLabels.add(label);

        // Look up the auto-import edit in the per-request cache first;
        // fall back to computing + caching it.
        let additionalTextEdits: Monaco.languages.TextEdit[] | undefined;
        if (autoImport) {
          const aiKey = `${autoImport.crate}::${autoImport.symbol}`;
          if (autoImportCache.has(aiKey)) {
            additionalTextEdits = autoImportCache.get(aiKey);
          } else {
            const result = buildAutoImportEdit(source, autoImport);
            additionalTextEdits = result ? [result.edit as Monaco.languages.TextEdit] : undefined;
            autoImportCache.set(aiKey, additionalTextEdits);
          }
        }

        suggestions.push({
          label, kind, detail,
          documentation: docs ? { value: docs } : undefined,
          insertText: insertText || label,
          insertTextRules: insertText && /\$\{/.test(insertText) ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range, sortText,
          additionalTextEdits,
        });
      };

      // Layer 1: Rustdoc symbols
      if (rustdocSymbols) {
        // §Intelligent (2026-08-16) — when after `::` or `.`, use the
        // curated type-members knowledge base to show ONLY the actual
        // members of the type before `::` / `.`. This makes simple mode
        // useful for `String::`, `Vec::`, `env.`, etc. — no more "same
        // 1855 results for anything::".
        //
        // For `::`: typeBeforeColonsName holds the type name (e.g. "String")
        // For `.`: we look up the variable's type via source parsing
        //
        // If the type isn't in our knowledge base, we return empty —
        // better to show nothing than 1855 wrong symbols.
        const shouldSkipRustdoc = (isAfterDot || isInTypePath) && !isAfterUse;

        if (!shouldSkipRustdoc) {
          for (const sym of rustdocSymbols) {
            if ((suggestions.length & 0xff) === 0 && token.isCancellationRequested) {
              return { suggestions: [] };
            }

            const s = sym as { name: string; kind: string; detail?: string; docs?: string; module?: string };
            const canAutoImport = !isAfterDot && !isAfterDoubleColon && !isAfterUse && !!s.module;
            const ai = canAutoImport ? { crate: s.module!, symbol: s.name, kind: s.kind } : undefined;

            if (isAfterUse) {
              add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1");
            } else {
              if (s.kind === "function" || s.kind === "macro") continue;
              add(s.name, kindMap[s.kind] ?? monaco.languages.CompletionItemKind.Text, s.detail, s.docs, undefined, "1", ai);
            }
          }
        }
      }

      // ─── §Intelligent (2026-08-16): type-aware completions after `::` and `.` ──
      // Uses the curated TYPE_MEMBERS knowledge base + source-parsed variable
      // types. This is what makes simple mode "intelligent" — it shows the
      // actual members of String/Vec/Env/etc. instead of all 1855 symbols.
      //
      // For LSP mode this is also used as a fallback when RA returns 0 items
      // (e.g. still indexing) — see registerLspProvider below.
      if (isInTypePath && typeBeforeColonsName) {
        // `String::` → show String's associated functions + constants
        const members = getTypeMembers(typeBeforeColonsName);
        if (members) {
          const crate = getTypeCrate(typeBeforeColonsName);
          // Pre-compute auto-import edit for the type itself (if not imported)
          let typeImportEdit: Monaco.languages.TextEdit[] | undefined;
          if (crate) {
            const result = buildAutoImportEdit(source, {
              crate,
              symbol: typeBeforeColonsName,
              kind: "struct", // struct/enum/trait — all auto-importable
            });
            if (result) typeImportEdit = [result.edit as Monaco.languages.TextEdit];
          }
          for (const m of members) {
            // After `::`, only show associated functions + constants (not methods)
            if (!m.is_associated) continue;
            add(
              m.name,
              m.kind === "function" ? monaco.languages.CompletionItemKind.Function
                : m.kind === "constant" ? monaco.languages.CompletionItemKind.Constant
                : m.kind === "type_alias" ? monaco.languages.CompletionItemKind.TypeParameter
                : monaco.languages.CompletionItemKind.Method,
              m.signature,
              m.docs,
              m.name + (m.signature ? `(${m.signature.match(/\(([^)]*)\)/)?.[1] ?? ""})` : ""),
              "0",
              undefined, // don't auto-import the member, just the type
            );
            // Attach the type's auto-import edit to the last suggestion
            if (typeImportEdit && suggestions.length > 0) {
              suggestions[suggestions.length - 1].additionalTextEdits = typeImportEdit;
            }
          }
        }
      } else if (isAfterDot) {
        // `my_var.` → look up my_var's type via source parsing, then show
        // that type's methods.
        // Match the variable name right before the `.` at the end of the line
        const dotMatch = lineUntilPosition.match(/([a-z_][a-z0-9_]*)\s*\.\s*$/i);
        if (dotMatch) {
          const varName = dotMatch[1];
          const typeName = lookupVariableType(source, varName);
          if (typeName) {
            const members = getTypeMembers(typeName);
            if (members) {
              for (const m of members) {
                // After `.`, only show methods (not associated functions)
                if (m.is_associated) continue;
                add(
                  m.name,
                  m.kind === "function" ? monaco.languages.CompletionItemKind.Method
                    : m.kind === "constant" ? monaco.languages.CompletionItemKind.Constant
                    : m.kind === "type_alias" ? monaco.languages.CompletionItemKind.TypeParameter
                    : monaco.languages.CompletionItemKind.Method,
                  m.signature,
                  m.docs,
                  m.name + (m.signature ? `(${m.signature.match(/\(([^)]*)\)/)?.[1] ?? ""})` : ""),
                  "0",
                  undefined,
                );
              }
            }
          }
        }
      }

      // Layer 2: Source-parsed symbols (skip when after . or in a Type:: path)
      if (!isAfterDot && !isInTypePath) {
        for (const item of currentItems) {
          if (item.kind === "module" && !isAfterUse) continue;
          add(item.label, kindMap[item.kind] ?? monaco.languages.CompletionItemKind.Text, item.detail, item.documentation, item.insertText || item.label, item.kind === "snippet" ? "0" : item.kind === "function" ? "1" : "2");
        }
      }

      // ─── Stale-response check ────────────────────────────────────
      // If a newer request has started for this model (user typed more),
      // discard our results — Monaco already moved on to the newer
      // request and would show stale suggestions if we returned ours.
      if (requestIds.get(modelKey) !== requestId || token.isCancellationRequested) {
        return { suggestions: [] };
      }

      // ─── Cache the result ────────────────────────────────────────
      // Store without the range (range is cursor-position-dependent and
      // gets re-applied on cache hit above).
      completionCache.set(cacheKey, {
        at: Date.now(),
        items: suggestions.map(({ range: _r, ...rest }) => rest as Monaco.languages.CompletionItem),
      });

      return { suggestions };
    },
  });

  console.log("[autocomplete] completion provider registered for 'rust' language (async + cached + race-protected)");

  // §LSP (2026-08-16) — simple-mode hover provider.
  // When the user hovers over a word, look it up in the rustdoc index
  // and show its docs. This is the best we can do without rust-analyzer
  // (which provides real type-aware hover via the LSP).
  const hoverProvider = monaco.languages.registerHoverProvider("rust", {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word || !word.word) return null;

      // Look up the word in the rustdoc index
      if (rustdocSymbols) {
        for (const sym of rustdocSymbols) {
          const s = sym as { name: string; kind: string; detail?: string; docs?: string; module?: string };
          if (s.name === word.word) {
            const contents: string[] = [];
            if (s.module) contents.push(`**${s.module}::${s.name}**`);
            else contents.push(`**${s.name}**`);
            if (s.kind) contents.push(`*${s.kind}*`);
            if (s.detail) contents.push(s.detail);
            if (s.docs) contents.push(s.docs);
            return {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn,
              },
              contents: contents.map(c => ({ value: c, isTrusted: true })),
            };
          }
        }
      }

      // Also check the type-members knowledge base for method docs
      const lineUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const typePathMatch = lineUntilPosition.match(/([A-Za-z_][A-Za-z0-9_]*)\s*::\s*[A-Za-z0-9_]*$/);
      if (typePathMatch) {
        const typeName = typePathMatch[1];
        const members = getTypeMembers(typeName);
        if (members) {
          const member = members.find(m => m.name === word.word);
          if (member) {
            const contents: string[] = [];
            contents.push(`**${typeName}::${member.name}**`);
            if (member.signature) contents.push("```rust\n" + member.signature + "\n```");
            if (member.docs) contents.push(member.docs);
            return {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn,
              },
              contents: contents.map(c => ({ value: c, isTrusted: true })),
            };
          }
        }
      }

      return null;
    },
  });

  // §LSP (2026-08-16) — simple-mode diagnostics (basic linting).
  // Without rust-analyzer, we can't do real type checking. But we CAN
  // catch obvious issues with regex:
  //   - Unused `use` imports (import is present but symbol never used)
  //   - Missing semicolons (line ends with an expression but no ;)
  //   - Unbalanced braces (rough count)
  // These are lightweight but catch common beginner mistakes.
  const diagnosticProvider = monaco.languages.registerCodeActionProvider("rust", {
    provideCodeActions: () => ({ actions: [], dispose: () => {} }),
  });

  // Run basic diagnostics on model change (debounced)
  const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const runBasicDiagnostics = (model: Monaco.editor.ITextModel) => {
    const modelKey = model.uri.toString();
    const existing = diagnosticTimers.get(modelKey);
    if (existing) clearTimeout(existing);
    diagnosticTimers.set(modelKey, setTimeout(() => {
      const source = model.getValue();
      const markers: Monaco.editor.IMarkerData[] = [];

      // Check for unused `use` imports
      const useRe = /^\s*use\s+(?:[a-zA-Z0-9_:]+::)?([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
      let m: RegExpExecArray | null;
      while ((m = useRe.exec(source)) !== null) {
        const symbol = m[1];
        // Check if the symbol is used anywhere in the file (excluding the use line itself)
        const usageRe = new RegExp(`\\b${symbol}\\b`, "g");
        const lines = source.split("\n");
        let used = false;
        for (let i = 0; i < lines.length; i++) {
          if (i === useRe.lastIndex - 1) continue; // skip the use line
          if (usageRe.test(lines[i])) {
            used = true;
            break;
          }
        }
        if (!used) {
          const lineIdx = source.slice(0, m.index).split("\n").length - 1;
          markers.push({
            startLineNumber: lineIdx + 1,
            startColumn: 1,
            endLineNumber: lineIdx + 1,
            endColumn: lines[lineIdx].length + 1,
            message: `Unused import: \`${symbol}\``,
            severity: Monaco.MarkerSeverity.Hint,
            source: "stellarforge",
            code: "unused-import",
          });
        }
      }

      monaco.editor.setModelMarkers(model, "stellarforge-simple", markers);
    }, 500));
  };

  // Run diagnostics on all existing models + on model creation
  monaco.editor.getModels().forEach(runBasicDiagnostics);
  const modelCreationListener = monaco.editor.onDidCreateModel(runBasicDiagnostics);
  const modelChangeListener = monaco.editor.onDidChangeModelLanguage(() => {
    monaco.editor.getModels().filter(m => m.getLanguageId() === "rust").forEach(runBasicDiagnostics);
  });

  // Re-run diagnostics when content changes
  const contentChangeDisposables: Monaco.IDisposable[] = [];
  monaco.editor.getModels().filter(m => m.getLanguageId() === "rust").forEach(model => {
    contentChangeDisposables.push(model.onDidChangeContent(() => runBasicDiagnostics(model)));
  });

  return {
    dispose: () => {
      provider.dispose();
      hoverProvider.dispose();
      diagnosticProvider.dispose();
      modelCreationListener.dispose();
      modelChangeListener.dispose();
      contentChangeDisposables.forEach(d => d.dispose());
      diagnosticTimers.forEach(t => clearTimeout(t));
      diagnosticTimers.clear();
      unsubscribe();
      completionCache.clear();
      requestIds.clear();
    },
  };
}

// ── LSP WebSocket Client (lightweight — no monaco-languageclient) ─────
//
// Connects to the LSP gateway server (mini-services/lsp-server/) via
// WebSocket. Speaks raw LSP/JSON-RPC protocol. The LSP server runs
// rust-analyzer as a separate process, managed by bm2 — completely
// independent of Next.js.
//
// This client is ~150 lines with ZERO npm dependencies (just WebSocket +
// JSON). Compare: monaco-languageclient + vscode-languageclient +
// vscode-ws-jsonrpc = ~200MB+ of bundle size + OOM issues.

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  // LSP-side auto-import edits (rust-analyzer provides these when it would
  // auto-import the symbol). Format: [{ range: { start, end }, newText }]
  additionalTextEdits?: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>;
}

class LspClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private connecting = false;
  // §Fix (2026-08-16) — made public so registerLspProvider can check if
  // an existing client matches the requested workspace before reusing it.
  readonly workspaceId: string;
  private fileUri: string | null = null;
  private fileVersion = 0;
  private diagnosticsHandler: ((diags: Array<{ line: number; message: string; severity: number }>) => void) | null = null;
  // §LSP (2026-08-16) — raw diagnostics callback for Monaco markers.
  // The simplified diagnosticsHandler above only gets {line, message, severity}.
  // The raw handler gets the full LSP diagnostic objects (with ranges, source,
  // code) so Monaco can show proper squiggly underlines.
  private rawDiagnosticsHandlers: Set<(uri: string, diagnostics: any[]) => void> = new Set();

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /** Returns true if the WebSocket is open AND the client is initialized. */
  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.initialized;
  }

  /**
   * §Fix (2026-08-16) — returns the URI of the currently-open file.
   * Used by the completion provider to decide whether to send didOpen
   * (new file) or didChange (same file, updated content).
   */
  getFileUri(): string | null {
    return this.fileUri;
  }

  onDiagnostics(handler: (diags: Array<{ line: number; message: string; severity: number }>) => void) {
    this.diagnosticsHandler = handler;
  }

  /**
   * §LSP (2026-08-16) — register a raw diagnostics handler.
   * Returns an unsubscribe function.
   * Used by the LSP providers to wire publishDiagnostics → Monaco markers.
   */
  onRawDiagnostics(handler: (uri: string, diagnostics: any[]) => void): () => void {
    this.rawDiagnosticsHandlers.add(handler);
    return () => this.rawDiagnosticsHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    // §Fix (2026-08-16) — if the WS is still open but `this.initialized`
    // is false (because RA crashed and the server sent a window/showMessage
    // notification which reset the flag), we need to re-initialize on the
    // EXISTING WS connection instead of opening a new one. Opening a new
    // WS would create a duplicate connection to the same workspace, which
    // would cause RA to crash again on the second `initialize`.
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.initialized) {
      return; // already connected + initialized
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.initialized) {
      // WS is open but RA restarted — re-initialize on the existing connection.
      console.log("[lsp] WS open but not initialized — re-initializing on existing connection");
      try {
        await this.initialize();
        console.log("[lsp] re-initialized after RA restart");
      } catch (err) {
        console.warn("[lsp] re-initialize failed:", err);
        throw err;
      }
      return;
    }
    if (this.connecting) {
      // Wait for ongoing connection
      while (this.connecting) await new Promise(r => setTimeout(r, 100));
      return;
    }

    this.connecting = true;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // §Fix (2026-08-16) — use "/lsp/" (WITH trailing slash) to bypass
    // nginx's auto-redirect on /lsp → /lsp/ (301). WebSocket clients
    // cannot follow 301 redirects during the handshake.
    // The LSP server now accepts both paths, but the client should use
    // the trailing-slash form directly to avoid the redirect entirely.
    const url = `${protocol}//${window.location.host}/lsp/?workspace=${encodeURIComponent(this.workspaceId)}`;

    // §Fix (2026-08-16) — sync project files to the server filesystem
    // BEFORE connecting. rust-analyzer needs Cargo.toml + source files
    // on disk to index the crate; without them, it starts but can't
    // provide any completions (silent failure — the WS connects, the
    // initialize request is sent, but no completion items come back).
    //
    // We fetch the file tree from the file-system store and POST it
    // to /workspace/<id>/sync. The LSP server writes these files to
    // /tmp/stellarforge-builds/<id>/ before spawning rust-analyzer.
    await this.syncProjectFiles();

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = async () => {
        console.log("[lsp] WebSocket connected");
        // Set up message handler
        this.ws!.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (err) {
            console.warn("[lsp] failed to parse message:", err);
          }
        };

        this.ws!.onerror = (err) => {
          console.warn("[lsp] WebSocket error:", err);
          this.connecting = false;
        };

        this.ws!.onclose = () => {
          console.log("[lsp] WebSocket closed");
          this.ws = null;
          this.initialized = false;
          this.connecting = false;
          // Reject all pending requests
          for (const [, p] of this.pending) {
            p.reject(new Error("WebSocket closed"));
          }
          this.pending.clear();
        };

        // Initialize LSP
        try {
          await this.initialize();
          this.connecting = false;
          resolve();
        } catch (err) {
          this.connecting = false;
          reject(err);
        }
      };

      this.ws!.onerror = (err) => {
        this.connecting = false;
        reject(new Error(`WebSocket connection failed: ${err}`));
      };
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest("initialize", {
      processId: null,
      clientInfo: { name: "stellarforge", version: "1.0" },
      rootUri: `file:///tmp/stellarforge-builds/${this.workspaceId}`,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: true, didClose: true, willSave: false, willSaveWaitUntil: false, didSave: true },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              commitCharactersSupport: false,
              preselectSupport: false,
              tagSupport: { valueSet: [] },
              insertReplaceSupport: false,
              resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
              insertTextModeSupport: { valueSet: [] },
              labelDetailsSupport: false,
            },
            completionList: { itemDefaults: [] },
            contextSupport: true,
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          // §LSP (2026-08-16) — declare all the capabilities we now support
          // so rust-analyzer knows it can send us these request types.
          definition: { linkSupport: false },
          typeDefinition: { linkSupport: false },
          implementation: { linkSupport: false },
          references: { },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
            symbolKind: { valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
            labelSupport: false,
          },
          rename: { prepareSupport: true, honorsChangeAnnotations: false },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
              parameterInformation: { labelOffsetSupport: true },
              activeParameterSupport: true,
            },
            contextSupport: true,
          },
          documentHighlight: { },
          foldingRange: {
            lineFoldingOnly: true,
            rangeLimit: 5000,
          },
          selectionRange: { },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"] },
            },
            isPreferredSupport: true,
            dataSupport: false,
            resolveSupport: { properties: ["edit"] },
            honorsChangeAnnotations: false,
          },
          formatting: { },
          onTypeFormatting: { },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: false,
            tagSupport: { valueSet: [1, 2] },
            codeDescriptionSupport: false,
            dataSupport: false,
          },
          semanticTokens: {
            requests: { range: false, full: false },
            tokenTypes: [],
            tokenModifiers: [],
            formats: [],
            overlappingTokenSupport: false,
            multilineTokenSupport: false,
            serverCancelSupport: false,
            augmentsSyntaxTokens: false,
          },
        },
        workspace: {
          didChangeWatchedFiles: { dynamicRegistration: false },
          symbol: {
            symbolKind: { valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
          },
          workspaceEdit: { resourceOperations: ["create", "rename", "delete"] },
        },
      },
      initializationOptions: {
        cargo: { target: "wasm32v1-none", features: "all" },
        // §LSP (2026-08-16) — enable checkOnSave so RA runs cargo check
        // in the background and reports diagnostics (errors/warnings)
        // as you type. This is what makes the "red squiggly underlines"
        // show up for compile errors.
        checkOnSave: {
          command: "clippy",
          extraArgs: ["--target", "wasm32v1-none"],
        },
        // Enable inlay hints (type annotations, parameter names)
        inlayHints: {
          bindingModeHints: { enabled: true },
          chainingHints: { enabled: true },
          closureReturnTypeHints: { enabled: "always" },
          lifetimeElisionHints: { enabled: "never" },
          maxLength: 25,
          parameterHints: { enabled: true },
          renderColons: true,
          typeHints: { enabled: true },
        },
      },
    });

    // Send initialized notification
    this.sendNotification("initialized", {});
    this.initialized = true;
    console.log("[lsp] initialized — rust-analyzer ready (full feature set: diagnostics, hover, goto-def, references, rename, symbols, signature help, folding, code actions, formatting)");
  }

  private handleMessage(msg: any) {
    // Response to a request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message || "LSP error"));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg.method === "textDocument/publishDiagnostics") {
      const uri = msg.params?.uri || "";
      const diagnostics = msg.params?.diagnostics || [];
      // Simplified handler (for backward compat — status bar etc.)
      const diags = diagnostics.map((d: any) => ({
        line: d.range?.start?.line ?? 0,
        message: d.message || "",
        severity: d.severity || 1,
      }));
      this.diagnosticsHandler?.(diags);
      // §LSP (2026-08-16) — raw handler for Monaco markers.
      // Gets the full diagnostic objects (range, source, code, severity)
      // so Monaco can show proper squiggly underlines + the lightbulb
      // quick-fix icon.
      for (const handler of this.rawDiagnosticsHandlers) {
        try { handler(uri, diagnostics); } catch {}
      }
      return;
    }

    // §Fix (2026-08-16) — handle window/showMessage notifications sent by
    // the LSP server when rust-analyzer crashes or fails to start. Without
    // this, the client never learns that RA restarted and keeps sending
    // completion requests to a fresh RA process that hasn't received
    // `initialize` yet → "expected initialize request, got completion".
    if (msg.method === "window/showMessage") {
      const message = msg.params?.message || "";
      const type = msg.params?.type ?? 1;
      console.log(`[lsp] server message (type=${type}): ${message}`);

      // If RA crashed/restarted, reset initialized so the next
      // getCompletion call will re-connect + re-initialize.
      // The server sends these messages when:
      //   - "rust-analyzer exited unexpectedly (code N)"
      //   - "rust-analyzer failed to start — ..."
      //   - "rust-analyzer has failed to start N times..."
      if (message.includes("rust-analyzer") && (
          message.includes("exited") ||
          message.includes("failed") ||
          message.includes("crashed"))) {
        console.warn("[lsp] rust-analyzer crashed/restarted — resetting initialized flag, will re-connect on next request");
        this.initialized = false;
        // Don't close the WS — the server will auto-restart RA. The next
        // getCompletion call will see !this.initialized and call connect()
        // again, which re-sends initialize to the new RA process.
      }
      return;
    }
  }

  // §LSP (2026-08-16) — made public so the LSP providers module can
  // send arbitrary LSP requests (hover, definition, references, etc.)
  // without duplicating the WebSocket + message-id + timeout logic.
  sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.ws.send(msg);

      // Timeout after 10s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timed out: ${method}`));
        }
      }, 10000);
    });
  }

  private sendNotification(method: string, params: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.ws.send(msg);
  }

  async didOpen(uri: string, languageId: string, text: string) {
    this.fileUri = uri;
    this.fileVersion = 0;
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 0, text },
    });
  }

  async didChange(text: string) {
    if (!this.fileUri) return;
    this.fileVersion++;
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: this.fileUri, version: this.fileVersion },
      contentChanges: [{ text }],
    });
  }

  /**
   * §Fix (2026-08-16) — Sync project files to the LSP server's filesystem.
   *
   * rust-analyzer needs Cargo.toml + source files on disk to index the
   * crate. Without them, it starts but can't provide completions.
   *
   * This POSTs the current file tree to /workspace/<id>/sync, which the
   * LSP server writes to /tmp/stellarforge-builds/<id>/ before spawning
   * rust-analyzer.
   *
   * Should be called:
   *   1. BEFORE initialize (so RA can index on startup)
   *   2. Whenever the file tree changes (so RA picks up new/changed files)
   *
   * Uses a dynamic import of the file-system store to avoid a circular
   * dependency at module load time.
   */
  async syncProjectFiles(): Promise<void> {
    try {
      const { useFileSystemStore } = await import("@/stores/file-system-store");
      const { flattenFiles } = await import("@/lib/soroban/sample-project");

      const tree = useFileSystemStore.getState().tree;
      const files = flattenFiles(tree).map((f) => ({
        path: f.path,
        content: f.content,
      }));

      if (files.length === 0) {
        console.warn("[lsp] no files to sync — file tree is empty");
        return;
      }

      const res = await fetch(
        `${window.location.origin}/workspace/${encodeURIComponent(this.workspaceId)}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files }),
        }
      );

      if (!res.ok) {
        console.warn(`[lsp] file sync failed: HTTP ${res.status}`);
        return;
      }

      // Notify rust-analyzer that the workspace files changed, so it
      // re-indexes. Without this, RA won't know about new files written
      // to disk after it started.
      this.sendNotification("workspace/didChangeWatchedFiles", {
        changes: files.map((f) => ({
          uri: `file:///tmp/stellarforge-builds/${this.workspaceId}/${f.path}`,
          type: 2, // Changed
        })),
      });

      console.log(`[lsp] synced ${files.length} files to LSP server`);
    } catch (err) {
      console.warn("[lsp] syncProjectFiles failed:", err);
    }
  }

  async getCompletion(uri: string, line: number, character: number): Promise<LspCompletionItem[]> {
    if (!this.initialized) {
      await this.connect();
    }

    try {
      const result = await this.sendRequest("textDocument/completion", {
        textDocument: { uri },
        position: { line, character },
      });

      if (Array.isArray(result)) return result;
      if (result?.items) return result.items;
      return [];
    } catch (err) {
      console.warn("[lsp] completion request failed:", err);
      return [];
    }
  }

  dispose() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pending.clear();
    this.initialized = false;
  }
}

// ── LSP-powered autocomplete provider ─────────────────────────────────

let lspClient: LspClient | null = null;
// §Fix (2026-08-16) — moved currentFileUri INTO the LspClient class (see
// `fileUri` field + `didOpen`/`didChange` methods). The module-level
// variable was a bug: it persisted across client recreations, causing the
// new client to send `didChange` instead of `didOpen` for a file that RA
// didn't know about (because the old client's session was gone).

// LSP CompletionItemKind → Monaco CompletionItemKind mapping
const LSP_KIND_MAP: Record<number, number> = {
  1: 14,   // Text → Text
  2: 2,    // Method → Function
  3: 2,    // Function → Function
  4: 2,    // Constructor → Function
  5: 5,    // Field → Field
  6: 22,   // Variable → Struct (closest)
  7: 6,    // Class → Class
  8: 8,    // Interface → Interface
  9: 9,    // Module → Module
  10: 3,   // Property → Property
  11: 13,  // Unit → Enum
  12: 13,  // Value → Enum
  13: 13,  // Enum → Enum
  14: 4,   // Keyword → Keyword
  15: 4,   // Snippet → Snippet
  16: 0,   // Color
  17: 19,  // File → File
  18: 25,  // Reference → Reference
  19: 22,  // Folder → Struct
  20: 13,  // EnumMember → Enum
  21: 21,  // Constant → Constant
  22: 25,  // Struct → Struct
  23: 13,  // Event → Enum
  24: 25,  // Operator → Operator
  25: 25,  // TypeParameter → TypeParameter
};

export function registerLspProvider(monaco: typeof Monaco, workspaceId: string): { dispose: () => void } {
  // §Fix (2026-08-16) — REUSE the existing LspClient if one already exists
  // for this workspace. Previously, every call to registerLspProvider created
  // a NEW LspClient and overwrote the module-level singleton. The OLD
  // client's WebSocket stayed open, so we ended up with multiple WS
  // connections to the same workspace. Each client sent `initialize`,
  // and rust-analyzer rejected the second one with "unknown request"
  // because it was already initialized from the first.
  //
  // This happens because the autocomplete provider is registered multiple
  // times: once on initial editor mount, and again on HMR / StrictMode
  // double-mount. The existing guards (autocompleteProviderRef +
  // window.__sorobanAutocomplete) dispose the PROVIDER, but the LspClient
  // singleton was still being recreated.
  if (lspClient && lspClient.workspaceId === workspaceId) {
    console.log(`[lsp] reusing existing LspClient for workspace: ${workspaceId}`);
    // Make sure it's connected (might have been disposed and recreated)
    if (!lspClient.isConnected()) {
      lspClient.connect().catch(err => {
        console.warn("[lsp] failed to reconnect:", err);
      });
    }
  } else {
    // Different workspace, or first time — create a new client
    if (lspClient) {
      // Different workspace — dispose the old one first
      console.log(`[lsp] switching workspace: ${lspClient.workspaceId} → ${workspaceId}`);
      lspClient.dispose();
    }
    lspClient = new LspClient(workspaceId);
    console.log(`[lsp] created new LspClient for workspace: ${workspaceId}`);

    // Connect in background (don't block)
    lspClient.connect().catch(err => {
      console.warn("[lsp] failed to connect:", err);
    });
  }

  // §Fix (2026-08-16) — DON'T register the simple provider as fallback in
  // LSP mode. Previously, both providers were registered simultaneously,
  // and Monaco merged their results. The simple provider dumps 1855
  // rustdoc symbols on every keystroke — even after `::`, where it can't
  // know which symbols belong to the type. This made `String::` show the
  // same 1855 generic symbols as `Vec::` or `anything::`, drowning out
  // RA's type-inferred completions.
  //
  // Now: in LSP mode, ONLY the LSP provider is registered. If RA returns
  // 0 items (still indexing), the user sees empty completions instead of
  // misleading generic ones. This is better UX — the user knows RA isn't
  // ready yet, rather than getting wrong suggestions.
  //
  // The LSP provider still adds local snippets (from autocomplete store)
  // as a supplement when NOT after `::` or `.` — see the supplement loop
  // below.
  // const fallback = registerAutocompleteProvider(monaco);  // REMOVED

  let currentItems: CompletionItem[] = useAutocompleteStore.getState().items;
  const unsubscribe = useAutocompleteStore.subscribe((state) => {
    currentItems = state.items;
  });
  currentItems = useAutocompleteStore.getState().items;

  // Per-model request-id tracking — discards stale LSP responses if the
  // user has typed more characters since the request was sent.
  // (LSP round-trip can take 100-500ms; without this, old suggestions
  // would appear after typing — Qwen AI flagged this race condition.)
  const lspRequestIds = new Map<string, number>();

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
    // §Fix (2026-08-16) — trigger characters must be SINGLE characters.
    // "::" is not a valid trigger character (LSP + Monaco expect single
    // chars). Having it in the array was silently ignored. The ":" entry
    // already handles "::" (typing the second ":" triggers again).
    triggerCharacters: [".", ":", "@", "#", '"', "/", "_", "-"],
    provideCompletionItems: async (model, position, _context, token) => {
      const modelKey = model.uri.toString();
      const requestId = (lspRequestIds.get(modelKey) ?? 0) + 1;
      lspRequestIds.set(modelKey, requestId);

      // If cancelled before we even start, bail out
      if (token.isCancellationRequested) return { suggestions: [] };

      const source = model.getValue();

      // §Fix (2026-08-16) — FIXED URI construction.
      // Previously: model.uri.path.replace("/", "") only replaced the FIRST
      // slash, mangling "src/test.rs" into "srctest.rs". Also had a hacky
      // special-case for "lib.rs" that assumed a specific file layout.
      //
      // New approach: just strip the leading slash from model.uri.path and
      // join with the workspace dir. This produces the correct file URI for
      // ANY file path, matching what /workspace/:id/sync wrote to disk.
      //
      // Examples:
      //   model.uri.path = "src/lib.rs"   → file:///tmp/.../local-project/src/lib.rs
      //   model.uri.path = "/src/lib.rs"  → file:///tmp/.../local-project/src/lib.rs
      //   model.uri.path = "Cargo.toml"   → file:///tmp/.../local-project/Cargo.toml
      const cleanPath = model.uri.path.replace(/^\//, "");
      const uri = `file:///tmp/stellarforge-builds/${workspaceId}/${cleanPath}`;

      // Sync document to LSP server
      if (lspClient) {
        // §Fix — use the client's own fileUri tracking (was a stale
        // module-level variable that persisted across client recreations).
        // The client sends didOpen when the URI changes, didChange when
        // the same file's content changes. This matches the LSP spec.
        const clientFileUri = lspClient.getFileUri();
        if (clientFileUri !== uri) {
          // File changed (or first time) — send didOpen
          await lspClient.didOpen(uri, "rust", source).catch(() => {});
        } else {
          // Same file — send didChange with updated content
          await lspClient.didChange(source).catch(() => {});
        }

        // Check cancellation after async didOpen/didChange
        if (token.isCancellationRequested) return { suggestions: [] };

        // Request completion from rust-analyzer
        const lspItems = await lspClient.getCompletion(
          uri,
          position.lineNumber - 1,  // LSP is 0-based
          position.column - 1
        );

        // ─── Stale-response check ──────────────────────────────────
        if (lspRequestIds.get(modelKey) !== requestId || token.isCancellationRequested) {
          return { suggestions: [] };
        }

        // §Fix — log what RA returned so we can diagnose "empty completions"
        if (lspItems.length > 0) {
          console.log(`[lsp] RA returned ${lspItems.length} items for ${cleanPath}:${position.lineNumber}:${position.column} (first: "${lspItems[0].label}")`);
        } else {
          console.log(`[lsp] RA returned 0 items for ${cleanPath}:${position.lineNumber}:${position.column} — RA may still be indexing deps`);
        }

        if (lspItems.length > 0) {
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

          const suggestions: Monaco.languages.CompletionItem[] = [];

          // Add LSP completions (from rust-analyzer — real type inference!)
          for (const item of lspItems) {
            const docs = typeof item.documentation === "string"
              ? item.documentation
              : item.documentation?.value;

            // Convert LSP additionalTextEdits (0-based) to Monaco (1-based).
            let monacoAdditionalEdits: Monaco.languages.TextEdit[] | undefined;
            if (item.additionalTextEdits && item.additionalTextEdits.length > 0) {
              monacoAdditionalEdits = item.additionalTextEdits.map((e) => ({
                range: {
                  startLineNumber: e.range.start.line + 1,
                  startColumn: e.range.start.character + 1,
                  endLineNumber: e.range.end.line + 1,
                  endColumn: e.range.end.character + 1,
                },
                text: e.newText,
              }));
            }

            suggestions.push({
              label: item.label,
              kind: LSP_KIND_MAP[item.kind ?? 1] ?? monaco.languages.CompletionItemKind.Text,
              detail: item.detail,
              documentation: docs ? { value: docs } : undefined,
              insertText: item.insertText || item.label,
              insertTextRules: item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
              sortText: item.sortText || "0",
              additionalTextEdits: monacoAdditionalEdits,
            });
          }

          // Also add local snippets (from autocomplete store) as supplement
          const trimmed = lineUntilPosition.trim();
          const isAfterUse = trimmed.startsWith("use ") || trimmed === "use";
          if (!isAfterDot && !isAfterDoubleColon) {
            for (const item of currentItems) {
              if (item.kind === "module" && !isAfterUse) continue;
              if (suggestions.some(s => s.label === item.label)) continue;
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
                sortText: item.kind === "snippet" ? "1" : "2",
              });
            }
          }

          return { suggestions };
        }

        // ─── §Intelligent fallback (2026-08-16) ──────────────────────
        // RA returned 0 items — likely still indexing deps (10-30s after
        // connect). Fall back to the curated type-members knowledge base
        // so the user gets useful completions for `String::`, `env.`, etc.
        // even before RA is ready. This makes the editor usable during
        // the RA warm-up period.
        if (lspItems.length === 0) {
          const lineUntilPositionForFallback = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const typePathMatch = lineUntilPositionForFallback.match(/([A-Za-z_][A-Za-z0-9_]*)\s*::\s*[A-Za-z0-9_]*$/);
          const dotMatch = lineUntilPositionForFallback.match(/([a-z_][a-z0-9_]*)\s*\.\s*$/i);

          const word = model.getWordUntilPosition(position);
          const fallbackRange: Monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column,
          };

          const fallbackSuggestions: Monaco.languages.CompletionItem[] = [];

          if (typePathMatch) {
            // `String::` fallback
            const typeName = typePathMatch[1];
            const members = getTypeMembers(typeName);
            if (members) {
              const crate = getTypeCrate(typeName);
              let typeImportEdit: Monaco.languages.TextEdit[] | undefined;
              if (crate) {
                const result = buildAutoImportEdit(source, { crate, symbol: typeName, kind: "struct" });
                if (result) typeImportEdit = [result.edit as Monaco.languages.TextEdit];
              }
              for (const m of members) {
                if (!m.is_associated) continue;
                fallbackSuggestions.push({
                  label: m.name,
                  kind: m.kind === "function" ? monaco.languages.CompletionItemKind.Function
                    : m.kind === "constant" ? monaco.languages.CompletionItemKind.Constant
                    : monaco.languages.CompletionItemKind.Method,
                  detail: m.signature,
                  documentation: m.docs ? { value: m.docs } : undefined,
                  insertText: m.name,
                  range: fallbackRange,
                  sortText: "0",
                  additionalTextEdits: typeImportEdit,
                });
              }
            }
          } else if (dotMatch) {
            // `my_var.` fallback — look up variable type
            const varName = dotMatch[1];
            const typeName = lookupVariableType(source, varName);
            if (typeName) {
              const members = getTypeMembers(typeName);
              if (members) {
                for (const m of members) {
                  if (m.is_associated) continue;
                  fallbackSuggestions.push({
                    label: m.name,
                    kind: monaco.languages.CompletionItemKind.Method,
                    detail: m.signature,
                    documentation: m.docs ? { value: m.docs } : undefined,
                    insertText: m.name,
                    range: fallbackRange,
                    sortText: "0",
                  });
                }
              }
            }
          }

          if (fallbackSuggestions.length > 0) {
            console.log(`[lsp] RA returned 0 — using type-members fallback (${fallbackSuggestions.length} items)`);
            return { suggestions: fallbackSuggestions };
          }
        }
      }

      // LSP not available — return empty (fallback provider handles it)
      return { suggestions: [] };
    },
  });

  console.log("[lsp] LSP provider registered for 'rust' language");

  // §LSP (2026-08-16) — register ALL the LSP-powered Monaco providers
  // (hover, goto-def, references, rename, symbols, signature help,
  // folding, code actions, formatting, diagnostics).
  // This is what makes it a "real editor" — not just autocomplete.
  let lspProviders: { disposables: Array<{ dispose: () => void }> } | null = null;
  let diagnosticsDispose: (() => void) | null = null;
  if (lspClient) {
    // Register all providers once the client is connected.
    // We do this asynchronously because the client might still be
    // connecting at this point.
    const registerOnceReady = async () => {
      // Wait for client to be initialized (max 10s)
      for (let i = 0; i < 50; i++) {
        if (lspClient && lspClient.isConnected()) break;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!lspClient || !lspClient.isConnected()) {
        console.warn("[lsp] client not ready — LSP providers not registered");
        return;
      }

      const { registerLspProviders, setupDiagnosticsHandler } = await import("@/lib/lsp/lsp-providers");
      lspProviders = registerLspProviders(monaco, lspClient as any, workspaceId);
      diagnosticsDispose = setupDiagnosticsHandler(
        monaco,
        (handler) => (lspClient as any).onRawDiagnostics(handler),
        workspaceId,
      );
      console.log("[lsp] all LSP providers registered (hover, goto-def, references, rename, symbols, signature help, folding, code actions, formatting, diagnostics)");
    };
    registerOnceReady().catch(err => console.warn("[lsp] failed to register LSP providers:", err));
  }

  return {
    dispose: () => {
      provider.dispose();
      // §LSP — dispose all LSP providers + diagnostics handler
      if (lspProviders) {
        for (const d of lspProviders.disposables) d.dispose();
        lspProviders = null;
      }
      if (diagnosticsDispose) {
        diagnosticsDispose();
        diagnosticsDispose = null;
      }
      unsubscribe();
      lspRequestIds.clear();
      if (lspClient) {
        lspClient.dispose();
        lspClient = null;
      }
    },
  };
}

// ── Unified completion provider (switches between simple + LSP) ───────

/**
 * Register the completion provider based on the user's settings.
 *
 * Modes:
 *   - "simple" (default): uses the local rustdoc index + source-parsed
 *     symbols. No server needed. Lightweight, instant.
 *   - "lsp": connects to the rust-analyzer LSP server via WebSocket.
 *     Real type inference, go-to-def, hover. Requires the LSP gateway
 *     server to be running (bm2-managed, independent of Next.js).
 *
 * The mode is stored in the theme-store (persisted to localStorage)
 * and can be toggled in Settings → Editor → Autocomplete Mode.
 */
export function registerCompletionProvider(
  monaco: typeof Monaco,
  workspaceId: string,
  mode: "simple" | "lsp"
): { dispose: () => void } {
  if (mode === "lsp") {
    console.log("[autocomplete] using LSP mode (rust-analyzer via WebSocket)");
    return registerLspProvider(monaco, workspaceId);
  }
  console.log("[autocomplete] using simple mode (local index)");
  return registerAutocompleteProvider(monaco);
}
