"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import type * as Monaco from "monaco-editor";
import { useCollabStore } from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";

/**
 * §5.2 — CRDT collaborative editing binding for Monaco.
 *
 * Binds a Monaco editor model to a Y.Text instance via y-monaco.
 * When the collab session is active, edits sync to all peers in realtime.
 * Cursor/selection presence is shared via the Yjs awareness protocol.
 *
 * When NOT in a collab session, the editor works normally (local only).
 */

interface UseCollabEditingOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  model: Monaco.editor.ITextModel | null;
  filePath: string;
}

export function useCollabEditing({ editor, model, filePath }: UseCollabEditingOptions) {
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [isCollabActive, setIsCollabActive] = useState(false);

  const connected = useCollabStore((s) => s.connected);
  const ydoc = useCollabStore((s) => s.ydoc);
  const provider = useCollabStore((s) => s.provider);
  const profile = useProfileStore((s) => s.profile);

  useEffect(() => {
    if (!connected || !ydoc || !provider || !editor || !model) {
      // Clean up any existing binding
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      // Use a microtask to avoid setState during effect
      queueMicrotask(() => setIsCollabActive(false));
      return;
    }

    // Get or create the Y.Text for this file
    const ytext = ydoc.getText(`file:${filePath}`);

    // Create the binding — this syncs Monaco edits to Y.Text and vice versa
    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      provider.awareness
    );
    bindingRef.current = binding;
    queueMicrotask(() => setIsCollabActive(true));

    // Update presence with cursor position on selection change
    const disposable = editor.onDidChangeCursorPosition((e) => {
      provider.awareness.setLocalStateField("cursor", {
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    // Also set the user info in awareness (in case it wasn't set yet)
    if (profile) {
      provider.awareness.setLocalStateField("user", {
        name: profile.username,
        color: useProfileStore.getState().accentColor,
      });
    }

    return () => {
      binding.destroy();
      disposable.dispose();
      bindingRef.current = null;
      queueMicrotask(() => setIsCollabActive(false));
    };
  }, [connected, ydoc, provider, editor, model, filePath, profile]);

  return { isCollabActive };
}
