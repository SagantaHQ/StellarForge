"use client";

import { useState, useCallback } from "react";
import { PROVIDERS, type ChatMessage, type ChatResponse, type ProviderId } from "@/lib/ai/providers";
import { useAIKeysStore } from "@/stores/ai-keys-store";
import { assembleContext, parseDiffFromResponse, type ParsedDiff } from "@/lib/ai/context-assembler";
import { useFileSystemStore } from "@/stores/file-system-store";
import { flattenFiles } from "@/lib/soroban/sample-project";

interface UseAIChatOptions {
  scope?: "smart-contract" | "ui-frontend" | "general" | "custom";
  customScopePaths?: string[];
  knowledgeSummary?: string;
}

interface ChatState {
  loading: boolean;
  error: string | null;
  lastResponse: ChatResponse | null;
  lastTokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  lastContextFiles: string[];
  lastContextTruncated: boolean;
  proposedDiffs: ParsedDiff[];
}

/**
 * Hook that wraps a single chat turn against the active BYOK provider.
 * Handles:
 *   - Context assembly (§9.9)
 *   - Provider call (direct or proxied)
 *   - Diff parsing from the response (§9.5)
 *   - Token usage readout
 */
export function useAIChat(opts: UseAIChatOptions = {}) {
  const [state, setState] = useState<ChatState>({
    loading: false,
    error: null,
    lastResponse: null,
    lastContextFiles: [],
    lastContextTruncated: false,
    proposedDiffs: [],
  });

  const getActiveConfig = useAIKeysStore((s) => s.getActiveConfig);
  const tokenBudget = useAIKeysStore((s) => s.tokenBudget);
  const tree = useFileSystemStore((s) => s.tree);
  const activeFilePath = useFileSystemStore((s) => s.activeFilePath);

  const sendMessage = useCallback(
    async (
      userMessage: string,
      history: ChatMessage[] = [],
      onChunk?: (text: string) => void,
      sendOpts?: { errorContext?: string }
    ): Promise<{ response: ChatResponse | null; diffs: ParsedDiff[] }> => {
      const activeConfig = getActiveConfig();
      if (!activeConfig) {
        setState((s) => ({
          ...s,
          error: "No AI provider configured. Open Settings → AI Provider to add an API key.",
        }));
        return { response: null, diffs: [] };
      }

      const { id, config } = activeConfig;
      const provider = PROVIDERS[id as ProviderId];
      if (!provider) {
        setState((s) => ({ ...s, error: `Unknown provider: ${id}` }));
        return { response: null, diffs: [] };
      }

      // Resolve the model (manual override if set)
      const model =
        config.model === "__custom__" && config.customModel
          ? config.customModel
          : config.model;

      if (!model) {
        setState((s) => ({
          ...s,
          error: "No model selected. Pick a model in Settings → AI Provider.",
        }));
        return { response: null, diffs: [] };
      }

      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        // §9.9 — assemble context with budget
        const context = assembleContext({
          tree,
          activeFilePath,
          userMessage,
          errorContext: sendOpts?.errorContext,
          scope: opts.scope,
          customScopePaths: opts.customScopePaths,
          budget: tokenBudget,
          knowledgeSummary: opts.knowledgeSummary,
        });

        // Build the final message list: prior history + assembled context
        // (the assembler returns system + user; we insert history between them)
        const messages: ChatMessage[] = [
          context.messages[0], // system
          ...history.filter((m) => m.role !== "system"),
          context.messages[1], // user (with full context)
        ];

        const response = await provider.chat(
          config.apiKey,
          model,
          messages,
          {
            maxTokens: 4096,
            temperature: 0.7,
          },
          config.baseUrl // for custom-openai
        );

        // Parse any diffs from the response (with known files for fuzzy matching)
        const allFilePaths = flattenFiles(tree).map((f) => f.path);
        const diffs = parseDiffFromResponse(response.content, allFilePaths);

        setState((s) => ({
          ...s,
          loading: false,
          lastResponse: response,
          lastTokenUsage: response.usage,
          lastContextFiles: context.filesIncluded,
          lastContextTruncated: context.truncated,
          proposedDiffs: diffs,
        }));

        if (onChunk) onChunk(response.content);

        return { response, diffs };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, loading: false, error: message }));
        return { response: null, diffs: [] };
      }
    },
    [getActiveConfig, tokenBudget, tree, activeFilePath, opts.scope, opts.customScopePaths, opts.knowledgeSummary]
  );

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const clearDiffs = useCallback(() => {
    setState((s) => ({ ...s, proposedDiffs: [] }));
  }, []);

  return {
    ...state,
    sendMessage,
    clearError,
    clearDiffs,
  };
}
