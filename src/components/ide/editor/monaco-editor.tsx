"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useThemeStore } from "@/stores/theme-store";
import { buildMonacoTheme } from "@/lib/themes/mappers";
import { registerSorobanLanguage, useAutocompleteProvider } from "./use-monaco";
import { useAttributionStore } from "@/stores/attribution-store";
import { lintSorobanSecurity, lintResultsToMarkers } from "@/lib/soroban/security-linter";

interface MonacoEditorProps {
  path: string;
  language: string;
  value: string;
  onChange?: (value: string) => void;
  onMount?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
  fontSize?: number;
  readOnly?: boolean;
  /** Show the glyph margin (for comment indicators) */
  glyphMargin?: boolean;
  /** Lines to highlight (e.g. focused comment anchor) */
  highlightedLines?: number[];
  /** Called when user right-clicks and selects "Add Comment" */
  onAddComment?: (lineNumber: number, lineContent: string) => void;
  /** Called when user clicks a glyph margin decoration */
  onGlyphClick?: (lineNumber: number) => void;
  /** Glyph decorations: line → color */
  glyphDecorations?: { lineNumber: number; color: string; tooltip: string }[];
}

function monacoLanguage(lang: string): string {
  switch (lang) {
    case "rust":
    case "soroban":
      // Use "rust" (not "soroban") so rust-analyzer LSP matches the document.
      // The Soroban Monarch tokenizer is still applied via registerSorobanLanguage()
      // which sets the tokenizer on the "rust" language id.
      return "rust";
    case "typescript":
    case "tsx":
      return "typescript";
    case "javascript":
    case "jsx":
      return "javascript";
    case "toml":
      return "ini";
    case "markdown":
      return "markdown";
    case "json":
      return "json";
    default:
      return "plaintext";
  }
}

let sorobanRegistered = false;

export function MonacoEditor({
  path,
  language,
  value,
  onChange,
  onMount,
  fontSize = 13,
  readOnly = false,
  glyphMargin = true,
  highlightedLines = [],
  onAddComment,
  onGlyphClick,
  glyphDecorations = [],
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Lightweight autocomplete — uses Monaco's built-in completion provider
  // (no heavy monaco-languageclient package). Provides Soroban snippets,
  // Rust keywords, soroban-sdk types, and source-parsed completions.
  useAutocompleteProvider();

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const highlightDecorationsRef = useRef<string[]>([]);
  const themeId = useThemeStore((s) => s.themeId);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);

  // Keep latest callbacks in refs so Monaco event handlers don't go stale
  const onAddCommentRef = useRef(onAddComment);
  const onGlyphClickRef = useRef(onGlyphClick);
  useEffect(() => { onAddCommentRef.current = onAddComment; }, [onAddComment]);
  useEffect(() => { onGlyphClickRef.current = onGlyphClick; }, [onGlyphClick]);

  const beforeMount: BeforeMount = (monaco) => {
    if (!sorobanRegistered) {
      registerSorobanLanguage(monaco);
      sorobanRegistered = true;
    }
    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
    monaco.editor.setTheme(theme.id);

    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, monacoLanguage(language));
    }

    // §6.1 — Add "Add Comment" to the editor context menu
    editor.addAction({
      id: "soroban.addComment",
      label: "Add Comment",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM],
      contextMenuGroupId: "soroban",
      contextMenuOrder: 1,
      run: (ed) => {
        const position = ed.getPosition();
        if (!position) return;
        const lineNumber = position.lineNumber;
        const lineContent = ed.getModel()?.getLineContent(lineNumber) ?? "";
        onAddCommentRef.current?.(lineNumber, lineContent);
      },
    });

    // §6.10 — Click on glyph margin → focus that thread
    editor.onMouseDown((e) => {
      const target = e.target;
      if (
        target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        target.position
      ) {
        onGlyphClickRef.current?.(target.position.lineNumber);
      }
    });

    onMount?.(editor, monaco);
  };

  // Live theme switching
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
    monaco.editor.setTheme(theme.id);
  }, [themeId, getActiveTheme]);

  // Apply glyph decorations (comment priority indicators)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (glyphDecorations.length === 0) {
      if (decorationsRef.current.length) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }

    const decorations: Monaco.editor.IModelDeltaDecoration[] = glyphDecorations.map((d) => ({
      range: new monaco.Range(d.lineNumber, 1, d.lineNumber, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: "soroban-comment-glyph",
        glyphMarginHoverMessage: { value: d.tooltip },
        // Use inline HTML color via CSS variable trick — Monaco doesn't natively
        // support per-decoration glyph color, so we use a CSS class + custom style
        marginClassName: "soroban-comment-margin",
      },
    }));

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      decorations
    );

    // Inject per-line glyph colors via a <style> tag
    const styleId = "soroban-glyph-colors";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    const rules = glyphDecorations
      .map((d, i) => {
        // Use line-number-scoped selector isn't possible with Monaco's class.
        // Workaround: render all glyphs with the accent color, but vary by priority
        // via a custom class we add per priority using a separate decoration.
        return "";
      })
      .join("\n");
    style.textContent = `
      .soroban-comment-glyph {
        background: var(--accent);
        border-radius: 50%;
        margin-left: 4px;
        width: 8px;
        height: 8px;
        margin-top: 6px;
      }
      .soroban-comment-glyph::before {
        content: "";
        display: block;
        width: 8px;
        height: 8px;
      }
    `;
  }, [glyphDecorations]);

  // Apply line highlights (when comment focused)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (highlightedLines.length === 0) {
      if (highlightDecorationsRef.current.length) {
        highlightDecorationsRef.current = editor.deltaDecorations(
          highlightDecorationsRef.current,
          []
        );
      }
      return;
    }

    const decorations: Monaco.editor.IModelDeltaDecoration[] = highlightedLines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: "soroban-line-highlight",
        overviewRuler: {
          color: "var(--accent)",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    }));

    highlightDecorationsRef.current = editor.deltaDecorations(
      highlightDecorationsRef.current,
      decorations
    );

    // Inject highlight style
    const styleId = "soroban-highlight-style";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `
      .soroban-line-highlight {
        background: var(--accent-subtle) !important;
        animation: soroban-highlight-pulse 1.2s ease-out;
      }
      @keyframes soroban-highlight-pulse {
        0% { background: var(--accent) !important; }
        100% { background: var(--accent-subtle) !important; }
      }
    `;
  }, [highlightedLines]);

  // §5.2 — Line attribution markers (who last edited each line)
  const attributions = useAttributionStore((s) => s.attributions);
  const attributionVisible = useAttributionStore((s) => s.visible);
  const attributionDecorationsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    const fileAttribs = attributions[path] ?? {};
    const lines = Object.keys(fileAttribs).map(Number);

    if (!attributionVisible || lines.length === 0) {
      if (attributionDecorationsRef.current.length) {
        attributionDecorationsRef.current = editor.deltaDecorations(
          attributionDecorationsRef.current,
          []
        );
      }
      return;
    }

    // Group consecutive lines with the same author into ranges
    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
    let currentAuthor: string | null = null;
    let rangeStart = 0;

    const sortedLines = lines.sort((a, b) => a - b);
    for (const line of sortedLines) {
      const attr = fileAttribs[line];
      if (!attr) continue;
      const authorKey = attr.authorId + (attr.viaAI ? "-ai" : "");
      if (authorKey !== currentAuthor) {
        if (currentAuthor !== null && rangeStart < line) {
          // Close previous range
          const prevAttr = fileAttribs[rangeStart];
          if (prevAttr) {
            decorations.push({
              range: new monaco.Range(rangeStart, 1, line - 1, 1),
              options: {
                isWholeLine: true,
                className: "soroban-attribution-line",
                marginClassName: "soroban-attribution-margin",
                hoverMessage: { value: buildAttributionTooltip(prevAttr) },
              },
            });
          }
        }
        currentAuthor = authorKey;
        rangeStart = line;
      }
    }
    // Close the last range
    if (currentAuthor !== null) {
      const attr = fileAttribs[rangeStart];
      if (attr) {
        const lastLine = sortedLines[sortedLines.length - 1];
        decorations.push({
          range: new monaco.Range(rangeStart, 1, lastLine, 1),
          options: {
            isWholeLine: true,
            className: "soroban-attribution-line",
            marginClassName: "soroban-attribution-margin",
            hoverMessage: { value: buildAttributionTooltip(attr) },
          },
        });
      }
    }

    attributionDecorationsRef.current = editor.deltaDecorations(
      attributionDecorationsRef.current,
      decorations
    );

    // Inject attribution styles
    const styleId = "soroban-attribution-style";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `
      .soroban-attribution-margin {
        border-left: 2px solid var(--accent);
        margin-left: 0;
      }
      .soroban-attribution-line {
        background: color-mix(in srgb, var(--accent) 4%, transparent);
      }
    `;
  }, [attributions, path, attributionVisible]);

  // §13.9 — Security linting (Soroban-specific static analysis)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    if (language !== "rust" && language !== "soroban") return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor.getModel();
    if (!model) return;

    // Debounce linting
    const timer = setTimeout(() => {
      const lintResults = lintSorobanSecurity(value);
      const markers = lintResultsToMarkers(lintResults);
      monaco.editor.setModelMarkers(model, "soroban-security", markers);
    }, 500);

    return () => clearTimeout(timer);
  }, [value, language]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden bg-[var(--mono-bg)]">
      <Editor
        path={path}
        language={monacoLanguage(language)}
        value={value}
        onChange={(v) => onChange?.(v ?? "")}
        beforeMount={beforeMount}
        onMount={handleMount}
        theme={themeId}
        loading={
          <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)] text-sm">
            <div className="flex items-center gap-2">
              <span className="skeleton-shimmer h-3 w-3 rounded-full" />
              <span>Loading editor…</span>
            </div>
          </div>
        }
        options={{
          fontSize,
          fontFamily: "var(--font-jetbrains-mono), var(--font-geist-mono), monospace",
          fontLigatures: true,
          lineHeight: 1.6,
          letterSpacing: 0.2,
          glyphMargin: glyphMargin,
          minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          padding: { top: 12, bottom: 12 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "explicit",
          renderLineHighlight: "all",
          renderWhitespace: "selection",
          renderControlCharacters: false,
          guides: {
            bracketPairs: true,
            indentation: true,
            highlightActiveBracketPair: true,
            highlightActiveIndentation: true,
          },
          bracketPairColorization: { enabled: true },
          autoClosingBrackets: "always",
          autoClosingQuotes: "always",
          autoSurround: "languageDefined",
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 4,
          insertSpaces: true,
          detectIndentation: true,
          wordBasedSuggestions: "allDocuments",
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: "on",
          quickSuggestions: { other: true, comments: false, strings: false },
          inlineSuggest: { enabled: true },
          stickyScroll: { enabled: true, maxLineCount: 4 },
          linkedEditing: true,
          readOnly,
          automaticLayout: true,
          contextmenu: true,
          mouseWheelZoom: true,
          multiCursorModifier: "ctrlCmd",
          selectionClipboard: false,
        }}
      />
    </div>
  );
}

/**
 * Expose a helper to scroll the editor to a specific line.
 * Returns null if the editor isn't mounted yet.
 */
export function scrollToLine(editor: Monaco.editor.IStandaloneCodeEditor | null, line: number) {
  if (!editor) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
}

function buildAttributionTooltip(attr: {
  authorName: string;
  timestamp: number;
  viaAI?: boolean;
  aiProvider?: string;
  aiModel?: string;
}): string {
  const time = new Date(attr.timestamp).toLocaleString();
  if (attr.viaAI) {
    return `**${attr.authorName}** via AI agent (${attr.aiProvider ?? "?"}/${attr.aiModel ?? "?"})\n\n${time}`;
  }
  return `**${attr.authorName}**\n\n${time}`;
}
