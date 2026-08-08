"use client";

import { useEffect, useRef, useCallback } from "react";
import type * as Monaco from "monaco-editor";
import { useProjectsStore } from "@/stores/projects-store";
import { pathToLspUri } from "./lsp-client";

/**
 * Hook that manages Monaco models with file:// URIs so the LSP client
 * (rust-analyzer) can identify and sync them.
 *
 * The @monaco-editor/react <Editor> component creates a model for each
 * unique `path` prop. By passing a file:// URI as the path, the model's
 * URI matches what rust-analyzer expects, enabling:
 *   - textDocument/didOpen with the correct URI
 *   - textDocument/completion with the correct file context
 *   - textDocument/publishDiagnostics targeting the correct model
 *   - Go-to-definition across files
 *
 * The hook also ensures the model's language is set correctly (rust for .rs,
 * toml for Cargo.toml) so the LSP client's documentSelector matches.
 */
export function useLspModels(
  filePath: string,
  language: string,
  content: string
) {
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const workspaceId = activeProjectId || "default";
  const modelsRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());

  // Convert the file path to a file:// URI for the LSP client
  const getModelUri = useCallback(() => {
    return pathToLspUri(workspaceId, filePath);
  }, [workspaceId, filePath]);

  // When the content changes externally (e.g. file switch), update the model
  // This is handled by @monaco-editor/react's `value` prop, but we also
  // ensure the model exists with the correct URI + language.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const monacoModule = await import("monaco-editor");
      const monaco = (monacoModule.default ?? monacoModule) as typeof Monaco;
      if (cancelled || !monaco?.editor) return;

      const uri = getModelUri();
      const monacoLang = mapLanguage(language);

      // Check if a model already exists for this URI
      let model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (!model) {
        // Create the model with the file URI + content + language
        model = monaco.editor.createModel(
          content,
          monacoLang,
          monaco.Uri.parse(uri)
        );
        modelsRef.current.set(uri, model);
      } else {
        // Model exists — update language if needed
        if (model.getLanguageId() !== monacoLang) {
          monaco.editor.setModelLanguage(model, monacoLang);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getModelUri, language, content]);

  // Cleanup all models on unmount
  useEffect(() => {
    return () => {
      // Don't dispose models on unmount — they're owned by @monaco-editor/react
      // and may be reused when switching back to a file.
    };
  }, []);

  return { getModelUri };
}

/** Map our internal language IDs to Monaco language IDs. */
function mapLanguage(lang: string): string {
  switch (lang) {
    case "rust":
    case "soroban":
      // Use "rust" (not "soroban") so rust-analyzer LSP matches the document.
      // The Soroban tokenizer is applied to "rust" via registerSorobanLanguage().
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
