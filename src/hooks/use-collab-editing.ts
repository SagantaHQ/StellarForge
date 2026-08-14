"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type * as Monaco from "monaco-editor";
import { useCollabStore } from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";

/**
 * §5.2 — CRDT collaborative editing binding for Monaco.
 *
 * Uses y-monaco's MonacoBinding to bind a Monaco editor model to a Y.Text
 * instance. When the collab session is active, edits sync to all peers.
 *
 * y-monaco is imported dynamically to avoid the 'monaco-editor/esm/vs/editor/
 * editor.api.js' module resolution issue at build time — the ESM path exists
 * in node_modules but webpack has trouble resolving it in some configs.
 * Dynamic import defers resolution to runtime when Monaco is already loaded.
 */

interface UseCollabEditingOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  model: Monaco.editor.ITextModel | null;
  filePath: string;
}

// Cache the MonacoBinding class after first dynamic import
let MonacoBindingClass: typeof import("y-monaco").MonacoBinding | null = null;

export function useCollabEditing({ editor, model, filePath }: UseCollabEditingOptions) {
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const [isCollabActive, setIsCollabActive] = useState(false);

  const connected = useCollabStore((s) => s.connected);
  const ydoc = useCollabStore((s) => s.ydoc);
  const provider = useCollabStore((s) => s.provider);
  const username = useProfileStore((s) => s.profile?.username);
  const accentColor = useProfileStore((s) => s.accentColor);

  useEffect(() => {
    if (!connected || !ydoc || !provider || !editor || !model) {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      setIsCollabActive(false);
      return;
    }

    let cancelled = false;

    // Dynamically import y-monaco (avoids build-time module resolution issues)
    (async () => {
      if (!MonacoBindingClass) {
        const mod = await import("y-monaco");
        MonacoBindingClass = mod.MonacoBinding;
      }
      if (cancelled || !MonacoBindingClass) return;

      // Get or create the Y.Text for this file
      const ytext = ydoc.getText(`file:${filePath}`);

      // If the Y.Text is empty, initialize it with the current file content
      if (ytext.toString().length === 0) {
        ytext.insert(0, model.getValue());
      }

      // Create the binding — syncs Monaco edits to Y.Text and vice versa
      const binding = new MonacoBindingClass(
        ytext,
        model,
        new Set([editor]),
        provider.awareness as unknown as import("y-protocols/awareness").Awareness
      );
      bindingRef.current = binding;
      setIsCollabActive(true);

      // Update presence with cursor position on selection change
      const disposable = editor.onDidChangeCursorPosition((e) => {
        provider.awareness.setLocalStateField("cursor", {
          line: e.position.lineNumber,
          column: e.position.column,
        });
      });

      // Set the user info in awareness
      if (username) {
        provider.awareness.setLocalStateField("user", {
          name: username,
          color: accentColor,
        });
      }

      // Store the disposable for cleanup
      const originalDestroy = binding.destroy.bind(binding);
      bindingRef.current = {
        destroy: () => {
          originalDestroy();
          disposable.dispose();
        },
      };
    })();

    return () => {
      cancelled = true;
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      setIsCollabActive(false);
    };
  }, [connected, ydoc, provider, editor, model, filePath, username, accentColor]);

  return { isCollabActive };
}
