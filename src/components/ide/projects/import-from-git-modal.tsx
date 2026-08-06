"use client";

import { useState, useEffect } from "react";
import {
  X,
  GitBranch,
  Loader2,
  AlertCircle,
  ArrowRight,
  Github,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImportFromGitModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (
    projectName: string,
    files: { path: string; content: string; language: string }[]
  ) => Promise<void>;
}

/**
 * Import from git modal.
 *
 * The user enters a git repo URL (+ optional branch) and a project name.
 * We POST to /api/projects/import-git which clones the repo server-side,
 * extracts text files, creates a Project + File records, and returns the
 * project + file count. We then call onImport to add the project to the
 * local store.
 *
 * The server handles:
 *   - Shallow clone (depth 1) with 30s timeout
 *   - Text-file filtering (extension-based)
 *   - node_modules / .git / target exclusion
 *   - 500 file limit
 *   - 1GB storage quota
 */
export function ImportFromGitModal({ open, onClose, onImport }: ImportFromGitModalProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [projectName, setProjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (open) {
      setRepoUrl("");
      setBranch("");
      setProjectName("");
      setSubmitting(false);
      setError(null);
      setStatus("");
    }
  }, [open]);

  async function handleImport() {
    const trimmedUrl = repoUrl.trim();
    const trimmedName = projectName.trim();
    if (!trimmedUrl || !trimmedName) return;

    setSubmitting(true);
    setError(null);
    setStatus("Cloning repository…");

    try {
      // Get the user's server ID (for the ownerId param)
      let ownerId: string | null = null;
      const profileState = (window as unknown as { __profileStore?: { profile: { address: string } | null } }).__profileStore;
      if (profileState?.profile?.address) {
        try {
          const res = await fetch(`/api/auth/session?address=${encodeURIComponent(profileState.profile.address)}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.loggedIn && data?.user?.id) ownerId = data.user.id;
          }
        } catch {
          // ignore
        }
      }

      if (!ownerId) {
        setError("You must be logged in to import from git.");
        setSubmitting(false);
        return;
      }

      setStatus("Cloning repository…");

      const res = await fetch("/api/projects/import-git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: trimmedUrl,
          branch: branch.trim() || undefined,
          ownerId,
          projectName: trimmedName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.detail || `HTTP ${res.status}`);
        setSubmitting(false);
        setStatus("");
        return;
      }

      setStatus("Fetching imported files…");

      // Fetch the created project's files from the server
      const fileRes = await fetch(`/api/projects/${data.project.id}`);
      if (!fileRes.ok) {
        // Project was created on the server but we couldn't fetch files.
        // The next syncFromServer call will pick it up.
        setError("Project created on server but file fetch failed. It will appear after sync.");
        setSubmitting(false);
        return;
      }

      const fileData = await fileRes.json();
      const serverFiles = (fileData.project.files ?? []).map(
        (f: { path: string; content: string; language: string }) => ({
          path: f.path,
          content: f.content,
          language: f.language,
        })
      );

      setStatus("Creating local project…");

      // Call onImport with the fetched files — the parent will create a
      // local project record that links to the server project.
      await onImport(trimmedName, serverFiles);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import from git");
      setSubmitting(false);
      setStatus("");
    }
  }

  if (!open) return null;

  const trimmedUrl = repoUrl.trim();
  const trimmedName = projectName.trim();
  const canImport = trimmedUrl.length > 0 && trimmedName.length >= 1 && trimmedName.length <= 60 && !submitting;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Import from git"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-raised)]">
              <GitBranch size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import from git</h2>
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
          {/* Repo URL */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
              Repository URL
            </label>
            <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
              <Github size={13} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/stellar/soroban-examples"
                className="flex-1 bg-transparent text-[13px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                autoFocus
              />
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              HTTPS or SSH URL. A shallow clone (depth 1) is performed server-side.
            </p>
          </div>

          {/* Branch (optional) */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
              Branch <span className="text-[var(--text-muted)] normal-case">(optional)</span>
            </label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          {/* Project name */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
              Project name
            </label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canImport) {
                  e.preventDefault();
                  handleImport();
                }
              }}
              placeholder="my-imported-contract"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              maxLength={60}
            />
          </div>

          {/* Status / progress */}
          {status && (
            <div className="flex items-center gap-2 rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-2.5 text-[11px] text-[var(--text-secondary)]">
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin text-[var(--accent)] shrink-0" />
              <span>{status}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
              <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Info note */}
          <div className="rounded-md bg-[var(--surface-sunken)] p-2.5 text-[10px] text-[var(--text-muted)] leading-relaxed">
            The repository is cloned server-side with a 30-second timeout. Only
            text files are imported (max 500 files). Directories like{" "}
            <code className="text-[var(--text-secondary)]">node_modules</code>,{" "}
            <code className="text-[var(--text-secondary)]">.git</code>, and{" "}
            <code className="text-[var(--text-secondary)]">target</code> are excluded.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="text-[10px] text-[var(--text-muted)]">
            {trimmedUrl ? "Ready to clone" : "Enter a repository URL"}
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
              onClick={handleImport}
              disabled={!canImport}
              className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <GitBranch size={13} strokeWidth={1.75} />
              )}
              Clone & import
              <ArrowRight size={12} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
