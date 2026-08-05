"use client";

import { useState } from "react";
import {
  Camera,
  RotateCcw,
  Trash2,
  Clock,
  Check,
  X,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSnapshotStore, type Snapshot } from "@/stores/snapshot-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { flattenFiles } from "@/lib/soroban/sample-project";

export function SnapshotPanel() {
  const snapshots = useSnapshotStore((s) => s.snapshots);
  const createSnapshot = useSnapshotStore((s) => s.createSnapshot);
  const deleteSnapshot = useSnapshotStore((s) => s.deleteSnapshot);
  const replaceTree = useFileSystemStore((s) => s.replaceTree);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);

  function handleCreate() {
    const tree = useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language,
    }));
    createSnapshot(
      name.trim() || `Snapshot ${new Date().toLocaleTimeString()}`,
      description.trim(),
      files
    );
    setName("");
    setDescription("");
  }

  async function handleRestore(snap: Snapshot) {
    await replaceTree(snap.files);
    setRestoreConfirm(null);
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={13} strokeWidth={1.75} className="text-[var(--accent)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Time-Travel Snapshots
          </span>
        </div>

        {/* Create snapshot */}
        <div className="space-y-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Snapshot name (e.g. 'before deploy')"
            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <Button
            size="sm"
            onClick={handleCreate}
            className="w-full h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-[11px]"
          >
            <Camera size={12} strokeWidth={1.75} />
            Capture snapshot
          </Button>
        </div>
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <Camera size={20} strokeWidth={1.5} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">
              No snapshots yet. Capture one to save the current state.
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Auto-snapshots are created before each deploy.
            </p>
          </div>
        ) : (
          snapshots.map((snap) => (
            <div
              key={snap.id}
              className="border-b border-[var(--border-subtle)] px-3 py-2 hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div className="flex items-center gap-2 mb-0.5">
                {snap.auto ? (
                  <Rocket size={11} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0" />
                ) : (
                  <Camera size={11} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
                )}
                <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                  {snap.name}
                </span>
                {snap.auto && (
                  <span className="rounded bg-[var(--surface-raised)] px-1 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                    auto
                  </span>
                )}
                <span className="ml-auto text-[10px] text-[var(--text-muted)] shrink-0">
                  {new Date(snap.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              {snap.description && (
                <p className="text-[11px] text-[var(--text-muted)] mb-1 pl-5">
                  {snap.description}
                </p>
              )}

              <div className="flex items-center gap-2 pl-5 text-[10px] text-[var(--text-muted)] mb-1.5">
                <span>{snap.files.length} files</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 pl-5">
                {restoreConfirm === snap.id ? (
                  <>
                    <span className="text-[10px] text-[var(--status-warning)]">Restore? This replaces all current files.</span>
                    <Button
                      size="sm"
                      onClick={() => handleRestore(snap)}
                      className="h-5 px-1.5 text-[10px] gap-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
                    >
                      <Check size={9} strokeWidth={2} />
                      Yes
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRestoreConfirm(null)}
                      className="h-5 px-1.5 text-[10px] text-[var(--text-muted)]"
                    >
                      <X size={9} strokeWidth={2} />
                      No
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setRestoreConfirm(snap.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
                    >
                      <RotateCcw size={9} strokeWidth={1.75} />
                      Restore
                    </button>
                    <button
                      onClick={() => deleteSnapshot(snap.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
                    >
                      <Trash2 size={9} strokeWidth={1.75} />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
