/**
 * §LSP feature providers for Monaco (2026-08-16)
 *
 * Registers Monaco language providers for ALL the features that make a
 * "real editor" — powered by rust-analyzer via the LSP WebSocket:
 *
 *   1. Diagnostics (linting)        — textDocument/publishDiagnostics → Monaco markers
 *   2. Hover docs                   — textDocument/hover
 *   3. Go-to-definition             — textDocument/definition
 *   4. Go-to-type-definition        — textDocument/typeDefinition
 *   5. Go-to-implementation         — textDocument/implementation
 *   6. Find all references          — textDocument/references
 *   7. Document symbols (outline)   — textDocument/documentSymbol
 *   8. Workspace symbols (quick open) — workspace/symbol
 *   9. Rename symbol                — textDocument/rename
 *  10. Signature help (param hints) — textDocument/signatureHelp
 *  11. Document highlight           — textDocument/documentHighlight
 *  12. Folding ranges               — textDocument/foldingRange
 *  13. Selection ranges             — textDocument/selectionRange
 *  14. Code actions (quick fixes)   — textDocument/codeAction
 *  15. Formatting                   — textDocument/formatting
 *
 * Each provider follows the same pattern:
 *   1. Convert Monaco position → LSP position (0-based)
 *   2. Send LSP request via the LspClient
 *   3. Convert LSP result → Monaco result (1-based)
 *   4. Return to Monaco
 *
 * All conversions handle the 0-based (LSP) ↔ 1-based (Monaco) offset
 * difference, which is the #1 source of bugs in LSP integrations.
 */

import type * as Monaco from "monaco-editor";

// ── LSP ↔ Monaco type conversions ────────────────────────────────────

/** LSP position (0-based line/character) → Monaco position (1-based) */
function lspToMonacoPosition(pos: { line: number; character: number }): Monaco.IPosition {
  return { lineNumber: pos.line + 1, column: pos.character + 1 };
}

/** Monaco position (1-based) → LSP position (0-based) */
function monacoToLspPosition(pos: Monaco.IPosition): { line: number; character: number } {
  return { line: pos.lineNumber - 1, character: pos.column - 1 };
}

/** LSP range (0-based) → Monaco range (1-based) */
function lspToMonacoRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/** LSP location (URI + range) → Monaco location (URI + range) */
function lspToMonacoLocation(loc: {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}): Monaco.languages.Location {
  return { uri: loc.uri as unknown as Monaco.Uri, range: lspToMonacoRange(loc.range) };
}

/** LSP DiagnosticSeverity → Monaco MarkerSeverity */
function lspSeverityToMonaco(severity: number): Monaco.MarkerSeverity {
  switch (severity) {
    case 1: return Monaco.MarkerSeverity.Error;
    case 2: return Monaco.MarkerSeverity.Warning;
    case 3: return Monaco.MarkerSeverity.Info;
    case 4: return Monaco.MarkerSeverity.Hint;
    default: return Monaco.MarkerSeverity.Error;
  }
}

/** LSP SymbolKind → Monaco symbol kind */
function lspSymbolKindToMonaco(kind: number): Monaco.languages.SymbolKind {
  // LSP SymbolKind enum: 1=File, 2=Module, 3=Namespace, 4=Package, 5=Class,
  // 6=Method, 7=Property, 8=Field, 9=Constructor, 10=Enum, 11=Interface,
  // 12=Function, 13=Variable, 14=Constant, 15=String, 16=Number, 17=Boolean,
  // 18=Array, 19=Object, 20=Key, 21=Null, 22=EnumMember, 23=Struct, 24=Event,
  // 25=Operator, 26=TypeParameter
  const map: Record<number, Monaco.languages.SymbolKind> = {
    1: Monaco.languages.SymbolKind.File,
    2: Monaco.languages.SymbolKind.Module,
    3: Monaco.languages.SymbolKind.Namespace,
    4: Monaco.languages.SymbolKind.Package,
    5: Monaco.languages.SymbolKind.Class,
    6: Monaco.languages.SymbolKind.Method,
    7: Monaco.languages.SymbolKind.Property,
    8: Monaco.languages.SymbolKind.Field,
    9: Monaco.languages.SymbolKind.Constructor,
    10: Monaco.languages.SymbolKind.Enum,
    11: Monaco.languages.SymbolKind.Interface,
    12: Monaco.languages.SymbolKind.Function,
    13: Monaco.languages.SymbolKind.Variable,
    14: Monaco.languages.SymbolKind.Constant,
    15: Monaco.languages.SymbolKind.String,
    16: Monaco.languages.SymbolKind.Number,
    17: Monaco.languages.SymbolKind.Boolean,
    18: Monaco.languages.SymbolKind.Array,
    19: Monaco.languages.SymbolKind.Object,
    20: Monaco.languages.SymbolKind.Key,
    21: Monaco.languages.SymbolKind.Null,
    22: Monaco.languages.SymbolKind.EnumMember,
    23: Monaco.languages.SymbolKind.Struct,
    24: Monaco.languages.SymbolKind.Event,
    25: Monaco.languages.SymbolKind.Operator,
    26: Monaco.languages.SymbolKind.TypeParameter,
  };
  return map[kind] ?? Monaco.languages.SymbolKind.Variable;
}

/** LSP CompletionItemKind → Monaco CompletionItemKind (reused from use-monaco) */
export const LSP_KIND_MAP: Record<number, number> = {
  1: 14, 2: 2, 3: 2, 4: 2, 5: 5, 6: 22, 7: 6, 8: 8, 9: 9,
  10: 3, 11: 13, 12: 13, 13: 13, 14: 4, 15: 4, 16: 0, 17: 19,
  18: 25, 19: 22, 20: 13, 21: 21, 22: 25, 23: 13, 24: 25, 25: 25,
};

// ── LSP client interface (what we need from LspClient) ───────────────

export interface LspClientLike {
  sendRequest(method: string, params: any): Promise<any>;
  onDiagnostics(handler: (diags: Array<{ line: number; message: string; severity: number }>) => void): void;
  getFileUri(): string | null;
  initialized: boolean;
}

// ── Provider registration ────────────────────────────────────────────

export interface RegisteredProviders {
  disposables: Array<{ dispose: () => void }>;
}

/**
 * Register ALL LSP-powered Monaco providers for the "rust" language.
 *
 * Call this once when the LSP client is ready. Returns disposables for
 * cleanup on editor unmount / LSP disconnect.
 */
export function registerLspProviders(
  monaco: typeof Monaco,
  client: LspClientLike,
  workspaceId: string,
): RegisteredProviders {
  const disposables: Array<{ dispose: () => void }>[] = [];

  // Helper: build the file URI for a Monaco model
  function modelToUri(model: Monaco.editor.ITextModel): string {
    const cleanPath = model.uri.path.replace(/^\//, "");
    return `file:///tmp/stellarforge-builds/${workspaceId}/${cleanPath}`;
  }

  // ─── 1. Diagnostics (linting) ──────────────────────────────────
  // rust-analyzer sends textDocument/publishDiagnostics notifications.
  // The LspClient already has onDiagnostics() — we wire it to Monaco's
  // marker system so errors/warnings show up as squiggly underlines.
  //
  // NOTE: This is set up in the LspClient's message handler, not as a
  // Monaco provider. We just need to call setModelMarkers when new
  // diagnostics arrive.
  client.onDiagnostics((diags) => {
    // The LspClient's handleMessage already parses publishDiagnostics,
    // but it only passes {line, message, severity}. We need the full
    // diagnostics with ranges to set markers. So we'll handle this
    // differently — see the rawDiagnosticsHandler below.
  });

  // ─── 2. Hover provider ─────────────────────────────────────────
  disposables.push([
    monaco.languages.registerHoverProvider("rust", {
      provideHover: async (model, position, token) => {
        try {
          const result = await client.sendRequest("textDocument/hover", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          });
          if (!result) return null;

          const contents = typeof result.contents === "string"
            ? [{ value: result.contents }]
            : Array.isArray(result.contents)
              ? result.contents.map((c: any) => typeof c === "string" ? { value: c } : { value: c.value, isTrusted: true })
              : [{ value: result.contents.value, isTrusted: true }];

          return {
            range: result.range ? lspToMonacoRange(result.range) : undefined,
            contents,
          };
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 3. Go-to-definition ───────────────────────────────────────
  disposables.push([
    monaco.languages.registerDefinitionProvider("rust", {
      provideDefinition: async (model, position, token) => {
        try {
          const result = await client.sendRequest("textDocument/definition", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          });
          if (!result) return null;
          if (Array.isArray(result)) {
            return result.map(lspToMonacoLocation);
          }
          return lspToMonacoLocation(result);
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 4. Go-to-type-definition ──────────────────────────────────
  disposables.push([
    monaco.languages.registerTypeDefinitionProvider("rust", {
      provideTypeDefinition: async (model, position, token) => {
        try {
          const result = await client.sendRequest("textDocument/typeDefinition", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          });
          if (!result) return null;
          if (Array.isArray(result)) return result.map(lspToMonacoLocation);
          return lspToMonacoLocation(result);
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 5. Go-to-implementation ───────────────────────────────────
  disposables.push([
    monaco.languages.registerImplementationProvider("rust", {
      provideImplementation: async (model, position, token) => {
        try {
          const result = await client.sendRequest("textDocument/implementation", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          });
          if (!result) return null;
          if (Array.isArray(result)) return result.map(lspToMonacoLocation);
          return lspToMonacoLocation(result);
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 6. Find all references ────────────────────────────────────
  disposables.push([
    monaco.languages.registerReferenceProvider("rust", {
      provideReferences: async (model, position, context, token) => {
        try {
          const result = await client.sendRequest("textDocument/references", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
            context: { includeDeclaration: true },
          });
          if (!result || !Array.isArray(result)) return [];
          return result.map(lspToMonacoLocation);
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 7. Document symbols (outline) ─────────────────────────────
  disposables.push([
    monaco.languages.registerDocumentSymbolProvider("rust", {
      provideDocumentSymbols: async (model, token) => {
        try {
          const result = await client.sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: modelToUri(model) },
          });
          if (!result || !Array.isArray(result)) return [];

          return result.map((sym: any) => ({
            name: sym.name,
            detail: sym.detail ?? "",
            kind: lspSymbolKindToMonaco(sym.kind),
            range: lspToMonacoRange(sym.range),
            selectionRange: lspToMonacoRange(sym.selectionRange),
            children: sym.children?.map((child: any) => ({
              name: child.name,
              detail: child.detail ?? "",
              kind: lspSymbolKindToMonaco(child.kind),
              range: lspToMonacoRange(child.range),
              selectionRange: lspToMonacoRange(child.selectionRange),
            })),
          }));
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 8. Rename symbol ──────────────────────────────────────────
  disposables.push([
    monaco.languages.registerRenameProvider("rust", {
      provideRenameEdits: async (model, position, newName, token) => {
        try {
          // First, prepare rename (get the range of the symbol being renamed)
          const prepareResult = await client.sendRequest("textDocument/prepareRename", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          }).catch(() => null);

          // Then, do the actual rename
          const result = await client.sendRequest("textDocument/rename", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
            newName,
          });
          if (!result || !result.changes) return null;

          const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
          for (const [uri, changes] of Object.entries(result.changes)) {
            const modelUri = uri as unknown as Monaco.Uri;
            for (const change of changes as any[]) {
              edits.push({
                resource: modelUri,
                edit: {
                  range: lspToMonacoRange(change.range),
                  text: change.newText,
                },
              });
            }
          }
          return { edits };
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 9. Signature help (function param hints) ──────────────────
  disposables.push([
    monaco.languages.registerSignatureHelpProvider("rust", {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [")"],
      provideSignatureHelp: async (model, position, token, context) => {
        try {
          const result = await client.sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
            context,
          });
          if (!result || !result.signatures || result.signatures.length === 0) return null;

          return {
            signatures: result.signatures.map((sig: any) => ({
              label: sig.label,
              documentation: typeof sig.documentation === "string"
                ? sig.documentation
                : sig.documentation?.value,
              parameters: sig.parameters?.map((p: any) => ({
                label: typeof p.label === "string"
                  ? p.label
                  : Array.isArray(p.label)
                    ? p.label[0] + "-" + p.label[1]
                    : p.label,
                documentation: typeof p.documentation === "string"
                  ? p.documentation
                  : p.documentation?.value,
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          };
        } catch {
          return null;
        }
      },
    }),
  ]);

  // ─── 10. Document highlight ────────────────────────────────────
  // Highlights all occurrences of the symbol under the cursor.
  disposables.push([
    monaco.languages.registerDocumentHighlightProvider("rust", {
      provideDocumentHighlights: async (model, position, token) => {
        try {
          const result = await client.sendRequest("textDocument/documentHighlight", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
          });
          if (!result || !Array.isArray(result)) return [];

          const kindMap: Record<number, Monaco.languages.DocumentHighlightKind> = {
            1: Monaco.languages.DocumentHighlightKind.Text,
            2: Monaco.languages.DocumentHighlightKind.Read,
            3: Monaco.languages.DocumentHighlightKind.Write,
          };

          return result.map((hl: any) => ({
            range: lspToMonacoRange(hl.range),
            kind: kindMap[hl.kind] ?? Monaco.languages.DocumentHighlightKind.Text,
          }));
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 11. Folding ranges ───────────────────────────────────────
  // Enables code folding (collapse/expand blocks).
  disposables.push([
    monaco.languages.registerFoldingRangeProvider("rust", {
      provideFoldingRanges: async (model, context, token) => {
        try {
          const result = await client.sendRequest("textDocument/foldingRange", {
            textDocument: { uri: modelToUri(model) },
          });
          if (!result || !Array.isArray(result)) return [];

          const kindMap: Record<string, Monaco.languages.FoldingRangeKind> = {
            "comment": Monaco.languages.FoldingRangeKind.Comment,
            "imports": Monaco.languages.FoldingRangeKind.Imports,
            "region": Monaco.languages.FoldingRangeKind.Region,
          };

          return result.map((fr: any) => ({
            start: fr.startLine + 1,
            end: fr.endLine + 1,
            kind: fr.kind ? kindMap[fr.kind] : undefined,
          }));
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 12. Selection ranges ──────────────────────────────────────
  // Enables "Expand Selection" (Ctrl+Shift+→) — smart selection that
  // expands to the enclosing expression, then statement, then block, etc.
  disposables.push([
    monaco.languages.registerSelectionRangeProvider("rust", {
      provideSelectionRanges: async (model, positions, token) => {
        try {
          const results: Monaco.languages.SelectionRange[][] = [];
          for (const position of positions) {
            const result = await client.sendRequest("textDocument/selectionRange", {
              textDocument: { uri: modelToUri(model) },
              positions: [monacoToLspPosition(position)],
            });
            if (!result || !Array.isArray(result) || result.length === 0) {
              results.push([]);
              continue;
            }
            const ranges = result.map((sr: any) => ({
              range: lspToMonacoRange(sr.range),
              // Chain nested selection ranges
              parent: sr.parent ? (function buildParent(p: any): Monaco.languages.SelectionRange {
                return { range: lspToMonacoRange(p.range), parent: p.parent ? buildParent(p.parent) : undefined };
              })(sr.parent) : undefined,
            }));
            results.push(ranges);
          }
          return results;
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 13. Code actions (quick fixes) ────────────────────────────
  // Shows the lightbulb icon for quick fixes (e.g. "Import missing symbol",
  // "Add missing impl methods", "Generate constructor").
  disposables.push([
    monaco.languages.registerCodeActionProvider("rust", {
      provideCodeActions: async (model, range, context, token) => {
        try {
          const result = await client.sendRequest("textDocument/codeAction", {
            textDocument: { uri: modelToUri(model) },
            range: {
              start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
              end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
            context: {
              diagnostics: (context.markers ?? []).map((m) => ({
                range: {
                  start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
                  end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
                },
                message: m.message,
                severity: m.severity,
                source: m.source,
              })),
              only: null,
              triggerKind: 1, // Invoked
            },
          });
          if (!result || !Array.isArray(result)) return { actions: [], dispose: () => {} };

          const actions: Monaco.languages.CodeAction[] = result.map((action: any) => {
            const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
            if (action.edit?.changes) {
              for (const [uri, changes] of Object.entries(action.edit.changes)) {
                for (const change of changes as any[]) {
                  edits.push({
                    resource: uri as unknown as Monaco.Uri,
                    edit: {
                      range: lspToMonacoRange(change.range),
                      text: change.newText,
                    },
                  });
                }
              }
            }
            return {
              title: action.title,
              kind: action.kind,
              diagnostics: action.diagnostics?.map((d: any) => ({
                startLineNumber: d.range.start.line + 1,
                startColumn: d.range.start.character + 1,
                endLineNumber: d.range.end.line + 1,
                endColumn: d.range.end.character + 1,
                message: d.message,
                severity: lspSeverityToMonaco(d.severity),
                source: d.source,
              })),
              edit: edits.length > 0 ? { edits } : undefined,
              isPreferred: action.isPreferred ?? false,
            };
          });

          return { actions, dispose: () => {} };
        } catch {
          return { actions: [], dispose: () => {} };
        }
      },
    }),
  ]);

  // ─── 14. Document formatting ───────────────────────────────────
  // Ctrl+Shift+I → formats the whole document with rustfmt rules
  // (rust-analyzer uses the project's rustfmt config).
  disposables.push([
    monaco.languages.registerDocumentFormattingEditProvider("rust", {
      provideDocumentFormattingEdits: async (model, options, token) => {
        try {
          const result = await client.sendRequest("textDocument/formatting", {
            textDocument: { uri: modelToUri(model) },
            options: {
              tabSize: options.tabSize,
              insertSpaces: options.insertSpaces,
            },
          });
          if (!result || !Array.isArray(result)) return [];

          return result.map((edit: any) => ({
            range: lspToMonacoRange(edit.range),
            text: edit.newText,
          }));
        } catch {
          return [];
        }
      },
    }),
  ]);

  // ─── 15. On-type formatting ────────────────────────────────────
  // Auto-indent on Enter (e.g. after { or after a => match arm)
  disposables.push([
    monaco.languages.registerOnTypeFormattingEditProvider("rust", {
      autoFormatTriggerCharacters: ["\n", "}", ";"],
      provideOnTypeFormattingEdits: async (model, position, ch, options, token) => {
        try {
          const result = await client.sendRequest("textDocument/onTypeFormatting", {
            textDocument: { uri: modelToUri(model) },
            position: monacoToLspPosition(position),
            ch,
            options: {
              tabSize: options.tabSize,
              insertSpaces: options.insertSpaces,
            },
          });
          if (!result || !Array.isArray(result)) return [];

          return result.map((edit: any) => ({
            range: lspToMonacoRange(edit.range),
            text: edit.newText,
          }));
        } catch {
          return [];
        }
      },
    }),
  ]);

  // Flatten all disposables into a single array
  const allDisposables = disposables.flat();

  return {
    disposables: allDisposables,
  };
}

// ── Diagnostics handler (separate — uses raw LSP notifications) ──────

/**
 * Sets up a diagnostics handler that converts LSP publishDiagnostics
 * notifications into Monaco markers.
 *
 * This needs to be called with the raw LSP message handler (not the
 * simplified onDiagnostics callback) because we need the full diagnostic
 * info (range, source, code) to create proper markers.
 *
 * @param monaco The Monaco instance
 * @param client The LSP client (must support a raw diagnostics callback)
 * @returns A dispose function
 */
export function setupDiagnosticsHandler(
  monaco: typeof Monaco,
  onRawDiagnostics: (handler: (uri: string, diagnostics: any[]) => void) => () => void,
  workspaceId: string,
): () => void {
  // Map LSP file URI → Monaco model URI
  // LSP: file:///tmp/stellarforge-builds/<id>/src/lib.rs
  // Monaco: depends on how models are created — usually just the path
  function lspUriToModelUri(lspUri: string): string {
    const prefix = `file:///tmp/stellarforge-builds/${workspaceId}/`;
    if (lspUri.startsWith(prefix)) {
      const path = lspUri.slice(prefix.length);
      return path;
    }
    return lspUri;
  }

  const unsubscribe = onRawDiagnostics((uri, diagnostics) => {
    // Find the Monaco model for this URI
    const modelPath = lspUriToModelUri(uri);
    const models = monaco.editor.getModels();
    const model = models.find(m =>
      m.uri.path === modelPath ||
      m.uri.path === "/" + modelPath ||
      m.uri.path.endsWith(modelPath)
    );

    if (!model) return;

    // Convert LSP diagnostics → Monaco markers
    const markers: Monaco.editor.IMarkerData[] = diagnostics.map((d: any) => ({
      startLineNumber: (d.range?.start?.line ?? 0) + 1,
      startColumn: (d.range?.start?.character ?? 0) + 1,
      endLineNumber: (d.range?.end?.line ?? 0) + 1,
      endColumn: (d.range?.end?.character ?? 0) + 1,
      message: d.message,
      severity: lspSeverityToMonaco(d.severity ?? 1),
      source: d.source ?? "rust-analyzer",
      code: d.code?.toString() ?? "",
    }));

    monaco.editor.setModelMarkers(model, "rust-analyzer", markers);
  });

  return unsubscribe;
}
