"use client";

import { create } from "zustand";
import { flattenFiles, type TreeNode } from "@/lib/soroban/sample-project";

/**
 * Autocomplete store — manages build artifacts for editor autocomplete.
 *
 * On project load (or package change), we POST the project files to
 * /api/autocomplete/build which:
 *   1. Parses the user's Rust source for public items
 *   2. Checks the DB cache for dependency artifacts (by package+version)
 *   3. Runs cargo doc for uncached deps
 *   4. Returns all artifacts merged
 *
 * The artifacts are then used by the Monaco completion provider to
 * suggest functions, structs, enums, traits, constants, type aliases,
 * and auto-imports.
 */

export interface CompletionItem {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextRules?: string;
  module?: string;
  packageName?: string;
}

export interface AutocompleteArtifacts {
  functions: CompletionItem[];
  structs: CompletionItem[];
  enums: CompletionItem[];
  traits: CompletionItem[];
  constants: CompletionItem[];
  typeAliases: CompletionItem[];
  imports: { path: string; name: string }[];
}

interface AutocompleteState {
  artifacts: AutocompleteArtifacts | null;
  loading: boolean;
  error: string | null;

  build: (tree: TreeNode[]) => Promise<void>;
  clear: () => void;
}

const emptyArtifacts: AutocompleteArtifacts = {
  functions: [],
  structs: [],
  enums: [],
  traits: [],
  constants: [],
  typeAliases: [],
  imports: [],
};

export const useAutocompleteStore = create<AutocompleteState>((set, get) => ({
  artifacts: null,
  loading: false,
  error: null,

  build: async (tree: TreeNode[]) => {
    if (get().loading) return;

    set({ loading: true, error: null });

    try {
      const files = flattenFiles(tree).map((f) => ({
        path: f.path,
        content: f.content,
      }));

      const res = await fetch("/api/autocomplete/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "local-project",
          files,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        set({ loading: false, error: err.error ?? `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      set({
        artifacts: data.artifacts || emptyArtifacts,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clear: () => set({ artifacts: null, error: null, loading: false }),
}));
