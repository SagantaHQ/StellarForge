"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useThemeStore } from "@/stores/theme-store";
import { buildMonacoTheme } from "@/lib/themes/mappers";
import { registerSorobanLanguage } from "./use-monaco";

interface MonacoEditorProps {
  path: string;
  language: string;
  value: string;
  onChange?: (value: string) => void;
  onMount?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
  fontSize?: number;
  readOnly?: boolean;
}

/** Map our internal language ids to Monaco language ids */
function monacoLanguage(lang: string): string {
  switch (lang) {
    case "rust":
    case "soroban":
      return "soroban";
    case "typescript":
    case "tsx":
      return "typescript";
    case "javascript":
    case "jsx":
      return "javascript";
    case "toml":
      return "ini"; // closest built-in
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
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const themeId = useThemeStore((s) => s.themeId);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);

  const beforeMount: BeforeMount = (monaco) => {
    if (!sorobanRegistered) {
      registerSorobanLanguage(monaco);
      sorobanRegistered = true;
    }
    // Register all themes so they're available for live switching
    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
    monaco.editor.setTheme(theme.id);

    // Update model language when path/language changes
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, monacoLanguage(language));
    }

    onMount?.(editor, monaco);
  };

  // Live theme switching
  useEffect(() => {
    if (!editorRef.current) return;
    const monaco = (window as unknown as { monaco?: typeof Monaco }).monaco;
    if (!monaco) return;
    const theme = getActiveTheme();
    monaco.editor.defineTheme(theme.id, buildMonacoTheme(theme));
    monaco.editor.setTheme(theme.id);
  }, [themeId, getActiveTheme]);

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
