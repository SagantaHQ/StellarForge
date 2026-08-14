"use client";
import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import type * as Monaco from "monaco-editor";
import { useCollabStore } from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";

interface UseCollabEditingOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  model: Monaco.editor.ITextModel | null;
  filePath: string;
}

export function useCollabEditing({ editor, model, filePath }: UseCollabEditingOptions) {
  const bindingRef = useRef<MonacoBinding | null>(null);
  const connected = useCollabStore((s) => s.connected);
  const ydoc = useCollabStore((s) => s.ydoc);
  const provider = useCollabStore((s) => s.provider);
  const username = useProfileStore((s) => s.profile?.username);
  const accentColor = useProfileStore((s) => s.accentColor);

  // Derived, not state: collab is "active" exactly when every prerequisite
  // for a binding is present — the same condition the effect below guards on.
  const isCollabActive = Boolean(connected && ydoc && provider && editor && model);

  useEffect(() => {
    if (!isCollabActive || !ydoc || !provider || !editor || !model) {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      return;
    }

    const ytext = ydoc.getText(`file:${filePath}`);
    if (ytext.toString().length === 0) {
      ytext.insert(0, model.getValue());
    }

    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      provider.awareness as unknown as import("y-protocols/awareness").Awareness
    );
    bindingRef.current = binding;

    const disposable = editor.onDidChangeCursorPosition((e) => {
      provider.awareness.setLocalStateField("cursor", {
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

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
    };
  }, [isCollabActive, ydoc, provider, editor, model, filePath, username, accentColor]);

  return { isCollabActive };
}
