"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type * as Monaco from "monaco-editor";
import { useCollabStore } from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";

/**
 * Lightweight Monaco ↔ Y.Text binding (replaces y-monaco).
 *
 * y-monaco imports 'monaco-editor/esm/vs/editor/editor.api.js' which webpack
 * can't resolve in Next.js. Instead of fighting webpack, we implement the
 * binding directly — it's ~40 lines and does the same thing:
 *   1. Monaco → Y.Text: on model content change, compute diff + apply to Y.Text
 *   2. Y.Text → Monaco: on Y.Text update, set model value (if different)
 *   3. Cursor/selection → awareness: on cursor change, update presence
 *
 * This is simpler than y-monaco (no remote cursor rendering) but sufficient
 * for same-browser multi-tab sync. Remote cursors can be added later via
 * Monaco delta decorations.
 */

interface UseCollabEditingOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  model: Monaco.editor.ITextModel | null;
  filePath: string;
}

export function useCollabEditing({ editor, model, filePath }: UseCollabEditingOptions) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isCollabActive, setIsCollabActive] = useState(false);
  const isApplyingRemote = useRef(false);

  const connected = useCollabStore((s) => s.connected);
  const ydoc = useCollabStore((s) => s.ydoc);
  const provider = useCollabStore((s) => s.provider);
  const username = useProfileStore((s) => s.profile?.username);
  const accentColor = useProfileStore((s) => s.accentColor);

  useEffect(() => {
    if (!connected || !ydoc || !provider || !editor || !model) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setIsCollabActive(false);
      return;
    }

    const ytext = ydoc.getText(`file:${filePath}`);

    // Initialize Y.Text with current content if empty
    if (ytext.toString().length === 0) {
      ytext.insert(0, model.getValue());
    } else if (ytext.toString() !== model.getValue()) {
      // Y.Text has content from another tab — update the model
      isApplyingRemote.current = true;
      model.setValue(ytext.toString());
      isApplyingRemote.current = false;
    }

    // 1. Monaco → Y.Text: on content change, replace Y.Text content
    const contentDisposable = model.onDidChangeContent(() => {
      if (isApplyingRemote.current) return; // skip if we're applying a remote update
      const newValue = model.getValue();
      const oldValue = ytext.toString();
      if (newValue !== oldValue) {
        // Simple approach: delete all + insert new
        ytext.delete(0, ytext.length);
        ytext.insert(0, newValue);
      }
    });

    // 2. Y.Text → Monaco: on Y.Text update, set model value
    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === "local") return; // skip our own changes
      const newValue = ytext.toString();
      if (newValue !== model.getValue()) {
        isApplyingRemote.current = true;
        const position = editor.getPosition();
        model.setValue(newValue);
        if (position) {
          editor.setPosition(position);
        }
        isApplyingRemote.current = false;
      }
    };
    ytext.doc.on("update", updateHandler);

    // 3. Cursor → awareness
    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      provider.awareness.setLocalStateField("cursor", {
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    // 4. Set user info in awareness
    if (username) {
      provider.awareness.setLocalStateField("user", {
        name: username,
        color: accentColor,
      });
    }

    setIsCollabActive(true);

    cleanupRef.current = () => {
      contentDisposable.dispose();
      cursorDisposable.dispose();
      ytext.doc.off("update", updateHandler);
    };

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setIsCollabActive(false);
    };
  }, [connected, ydoc, provider, editor, model, filePath, username, accentColor]);

  return { isCollabActive };
}
