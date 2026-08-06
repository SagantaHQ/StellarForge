"use client";

import { useState, useEffect } from "react";
import { X, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectMeta } from "@/stores/projects-store";

interface DeleteProjectModalProps {
  open: boolean;
  project: ProjectMeta | null;
  onClose: () => void;
  onConfirm: (projectId: string) => Promise<void>;
}

/**
 * Delete project confirmation modal.
 *
 * To prevent accidental data loss, the user MUST type the project's exact
 * name into the text box. The Confirm button is disabled until the typed
 * value matches the project name exactly (case-sensitive).
 */
export function DeleteProjectModal({
  open,
  project,
  onClose,
  onConfirm,
}: DeleteProjectModalProps) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes or target project changes
  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setSubmitting(false);
    }
  }, [open, project?.id]);

  if (!open || !project) return null;

  const matches = typed === project.name;
  const canConfirm = matches && !submitting;

  async function handleConfirm() {
    if (!canConfirm || !project) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && canConfirm) {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Delete project"
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-[var(--status-error)]/40 bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--status-error)_15%,transparent)]">
              <AlertTriangle size={15} strokeWidth={2} className="text-[var(--status-error)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Delete project
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
            You are about to permanently delete the project{" "}
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {project.name}
            </span>
            . This will remove:
          </p>

          <ul className="ml-4 list-disc space-y-1 text-[12px] text-[var(--text-muted)]">
            <li>All source files in this project</li>
            <li>All file-level comments and threads</li>
            <li>All snapshots and audit log entries</li>
            <li>All collaboration sessions and share permissions</li>
            {project.serverProjectId && (
              <li className="text-[var(--status-warning)]">
                The project will also be removed from the server (synced)
              </li>
            )}
          </ul>

          <div className="rounded-md border border-[var(--status-error)]/30 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-3">
            <p className="text-[12px] text-[var(--text-secondary)] mb-2">
              Type the project name to confirm:
            </p>
            <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={project.name}
                className="flex-1 bg-transparent font-mono text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                autoComplete="off"
                spellCheck={false}
              />
              {typed && (
                <span
                  className={
                    matches
                      ? "text-[10px] font-medium text-[var(--status-success)]"
                      : "text-[10px] font-medium text-[var(--status-warning)]"
                  }
                >
                  {matches ? "✓ matches" : "✗ no match"}
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              This action cannot be undone.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2 text-[11px] text-[var(--status-error)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="text-[10px] text-[var(--text-muted)]">
            {matches ? "Ready to delete" : "Name must match exactly"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="gap-1.5 bg-[var(--status-error)] text-white hover:bg-[color-mix(in_srgb,var(--status-error)_88%,black)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <Trash2 size={13} strokeWidth={1.75} />
              )}
              Delete project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
