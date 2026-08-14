// Smoke test for the autocomplete improvements.
// Verifies the changes address the issues Qwen AI flagged.

const fs = require("fs");

const useMonacoCode = fs.readFileSync(
  "./src/components/ide/editor/use-monaco.ts",
  "utf8"
);

const editorCode = fs.readFileSync(
  "./src/components/ide/editor/monaco-editor.tsx",
  "utf8"
);

let pass = 0, fail = 0;
function check(name, ok) {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}`);
  if (ok) pass++; else fail++;
}

// ─── registerAutocompleteProvider improvements ────────────────────────

check(
  "registerAutocompleteProvider is async",
  useMonacoCode.includes("provideCompletionItems: async (model, position, _context, token)") ||
  useMonacoCode.includes("provideCompletionItems: async (model, position, _context, token) =>")
);

check(
  "registerAutocompleteProvider has per-model request-id tracking",
  useMonacoCode.includes("const requestIds = new Map") &&
  useMonacoCode.includes("requestIds.get(modelKey) !== requestId")
);

check(
  "registerAutocompleteProvider has 15s TTL cache",
  useMonacoCode.includes("CACHE_TTL_MS = 15_000") &&
  useMonacoCode.includes("completionCache = new Map")
);

check(
  "registerAutocompleteProvider invalidates cache on autocomplete-store change",
  useMonacoCode.includes("completionCache.clear()")
);

check(
  "registerAutocompleteProvider uses structural trigger chars only (no single letters)",
  // The new triggerCharacters array should NOT include 'u', 'p', 'f', etc.
  // Check that the old single-letter array is gone
  !useMonacoCode.includes('"u", "p", "f", "s", "e", "m", "c", "t", "v", "a", "b"') &&
  // And the new structural array is present
  useMonacoCode.includes('"::", "@"') || useMonacoCode.includes('".", ":", "::"')
);

check(
  "registerAutocompleteProvider pre-computes typeBeforeColonsEdit once per request",
  useMonacoCode.includes("typeBeforeColonsEdit") &&
  useMonacoCode.includes("// Pre-compute the edit ONCE")
);

check(
  "registerAutocompleteProvider has per-request autoImport cache",
  useMonacoCode.includes("autoImportCache = new Map") &&
  useMonacoCode.includes("autoImportCache.has(aiKey)")
);

check(
  "registerAutocompleteProvider checks cancellation token during iteration",
  useMonacoCode.includes("token.isCancellationRequested") &&
  useMonacoCode.includes("(suggestions.length & 0xff) === 0")
);

check(
  "registerAutocompleteProvider disposes cache + requestIds on unmount",
  useMonacoCode.includes("completionCache.clear()") &&
  useMonacoCode.includes("requestIds.clear()")
);

check(
  "registerAutocompleteProvider logs new async+cached mode in console",
  useMonacoCode.includes("async + cached + race-protected")
);

// ─── registerLspProvider improvements ──────────────────────────────────

check(
  "registerLspProvider is async (was already)",
  useMonacoCode.includes("registerLspProvider") &&
  useMonacoCode.includes("provideCompletionItems: async (model, position, _context, token)")
);

check(
  "registerLspProvider has per-model request-id tracking",
  useMonacoCode.includes("lspRequestIds = new Map") &&
  useMonacoCode.includes("lspRequestIds.get(modelKey) !== requestId")
);

check(
  "registerLspProvider uses structural trigger chars only (no single letters)",
  !useMonacoCode.includes('"a", "b", "c", "d", "e", "f", "g", "h", "i", "l", "m", "p", "r", "s", "t", "u", "v", "w"')
);

check(
  "registerLspProvider checks cancellation before starting",
  useMonacoCode.includes("if (token.isCancellationRequested) return { suggestions: [] };")
);

check(
  "registerLspProvider checks cancellation after didOpen/didChange",
  useMonacoCode.includes("Check cancellation after async didOpen/didChange")
);

check(
  "registerLspProvider disposes lspRequestIds on unmount",
  useMonacoCode.includes("lspRequestIds.clear()")
);

// ─── monaco-editor.tsx HMR guard ───────────────────────────────────────

check(
  "monaco-editor.tsx has window.__sorobanAutocomplete HMR guard",
  editorCode.includes("__sorobanAutocomplete") &&
  editorCode.includes("globalAutocomplete")
);

check(
  "monaco-editor.tsx disposes previous provider before registering new",
  editorCode.includes("autocompleteProviderRef.current.dispose()")
);

check(
  "monaco-editor.tsx clears ref after dispose",
  editorCode.includes("autocompleteProviderRef.current = null;")
);

check(
  "monaco-editor.tsx sets window.__sorobanAutocomplete after register",
  editorCode.includes("(window as unknown as { __sorobanAutocomplete?: typeof provider }).__sorobanAutocomplete = provider")
);

// ─── Editor options (already correct, just verifying) ─────────────────

check(
  "monaco-editor.tsx has quickSuggestions.other=true",
  editorCode.includes("quickSuggestions: { other: true") &&
  editorCode.includes("comments: false") &&
  editorCode.includes("strings: false")
);

check(
  "monaco-editor.tsx has suggestOnTriggerCharacters=true",
  editorCode.includes("suggestOnTriggerCharacters: true")
);

check(
  "monaco-editor.tsx has acceptSuggestionOnEnter='on'",
  editorCode.includes('acceptSuggestionOnEnter: "on"')
);

check(
  "monaco-editor.tsx has wordBasedSuggestions",
  editorCode.includes("wordBasedSuggestions:")
);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
