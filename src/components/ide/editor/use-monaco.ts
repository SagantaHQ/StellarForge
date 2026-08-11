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
}

class LspClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private connecting = false;
  private workspaceId: string;
  private fileUri: string | null = null;
  private fileVersion = 0;
  private diagnosticsHandler: ((diags: Array<{ line: number; message: string; severity: number }>) => void) | null = null;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  onDiagnostics(handler: (diags: Array<{ line: number; message: string; severity: number }>) => void) {
    this.diagnosticsHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) {
      // Wait for ongoing connection
      while (this.connecting) await new Promise(r => setTimeout(r, 100));
      return;
    }

    this.connecting = true;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/lsp?workspace=${encodeURIComponent(this.workspaceId)}`;

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
      clientInfo: { name: "soroban-build", version: "1.0" },
      rootUri: `file:///tmp/soroban-builds/${this.workspaceId}`,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: true, didClose: true },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
        },
      },
      initializationOptions: {
        cargo: { target: "wasm32v1-none", features: "all" },
      },
    });

    // Send initialized notification
    this.sendNotification("initialized", {});
    this.initialized = true;
    console.log("[lsp] initialized — rust-analyzer ready");
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
      const diags = (msg.params?.diagnostics || []).map((d: any) => ({
        line: d.range?.start?.line ?? 0,
        message: d.message || "",
        severity: d.severity || 1,
      }));
      this.diagnosticsHandler?.(diags);
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
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
let currentFileUri: string | null = null;

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
  // Create LSP client
  lspClient = new LspClient(workspaceId);

  // Connect in background (don't block)
  lspClient.connect().catch(err => {
    console.warn("[lsp] failed to connect:", err);
  });

  // Also keep the simple provider as fallback (snippets + SDK symbols)
  const fallback = registerAutocompleteProvider(monaco);

  let currentItems: CompletionItem[] = useAutocompleteStore.getState().items;
  const unsubscribe = useAutocompleteStore.subscribe((state) => {
    currentItems = state.items;
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
    triggerCharacters: [".", ":", "a", "b", "c", "d", "e", "f", "g", "h", "i", "l", "m", "p", "r", "s", "t", "u", "v", "w"],
    provideCompletionItems: async (model, position) => {
      const source = model.getValue();
      const uri = `file:///tmp/soroban-builds/${workspaceId}/${model.uri.path.split("/").pop() === "lib.rs" ? "src/lib.rs" : model.uri.path.replace("/", "")}`;

      // Sync document to LSP server
      if (lspClient) {
        if (currentFileUri !== uri) {
          // File changed — send didOpen
          currentFileUri = uri;
          await lspClient.didOpen(uri, "rust", source).catch(() => {});
        } else {
          // Same file — send didChange
          await lspClient.didChange(source).catch(() => {});
        }

        // Request completion from rust-analyzer
        const lspItems = await lspClient.getCompletion(
          uri,
          position.lineNumber - 1,  // LSP is 0-based
          position.column - 1
        );

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
      }

      // LSP not available — return empty (fallback provider handles it)
      return { suggestions: [] };
    },
  });

  console.log("[lsp] LSP provider registered for 'rust' language");

  return {
    dispose: () => {
      provider.dispose();
      fallback.dispose();
      unsubscribe();
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
