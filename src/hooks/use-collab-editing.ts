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
  // Select primitive fields to avoid unnecessary re-renders
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

    // Get or create the Y.Text for this file
    const ytext = ydoc.getText(`file:${filePath}`);

    // If the Y.Text is empty, initialize it with the current file content
    if (ytext.toString().length === 0) {
      ytext.insert(0, model.getValue());
    }

    // Create the binding — syncs Monaco edits to Y.Text and vice versa
    // Cast awareness to any since MonacoBinding expects y-protocols/Awareness
    // but our SimpleAwareness has the same interface
    const binding = new MonacoBinding(
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

    return () => {
      binding.destroy();
      disposable.dispose();
      bindingRef.current = null;
      setIsCollabActive(false);
    };
  }, [connected, ydoc, provider, editor, model, filePath, username, accentColor]);

  return { isCollabActive };
}
