"use client";

import { useState } from "react";
import {
  GitCommit,
  Github,
  Check,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommitToGithubModal } from "../projects/commit-to-github-modal";
import { LoadingOverlay } from "../ui/loading-overlay";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProfileStore } from "@/stores/profile-store";
import { useProjectsStore } from "@/stores/projects-store";
import { useGithubOAuth } from "@/hooks/use-github-oauth";
import { flattenFiles } from "@/lib/soroban/sample-project";

/**
 * GitPanel — Source Control panel for the left sidebar.
 *
 * Shows GitHub connection status, linked repo info, and a sync status
 * comparison (added/modified/deleted/unchanged files). Requires GitHub
 * connection — shows a "Connect GitHub" CTA when not connected.
 *
 * The "Commit" button opens the CommitToGithubModal which handles:
 *   - Repo selection
 *   - Branch input
 *   - Commit message
 *   - Conflict detection (via /api/github/compare)
 *   - Force commit (overwrite remote)
 */
export function GitPanel() {
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<{
    hasConflicts: boolean;
    hasChanges: boolean;
    summary: { added: number; modified: number; deleted: number; unchanged: number };
    files: { added: string[]; modified: { path: string }[]; deleted: string[]; unchanged: string[] };
    branch: string;
  } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const tree = useFileSystemStore((s) => s.tree);
  const githubConnected = useProfileStore((s) => s.githubConnected);
  const githubUsername = useProfileStore((s) => s.githubUsername);
  const profile = useProfileStore((s) => s.profile);
  const { connectGithub: connectGithubPopup, connecting: oauthConnecting } = useGithubOAuth();
  const activeProject = useProjectsStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) ?? null : null;
  });

  const files = flattenFiles(tree);

  // Determine the GitHub repo link for the active project.
  // Parse from project description if it contains "Imported from https://github.com/owner/repo"
  const [repoOwner, repoName] = (() => {
    const desc = activeProject?.description ?? "";
    const match = desc.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/);
    if (match) return [match[1], match[2].replace(/\.git$/, "")];
    return [null, null];
  })();

  async function handleCompare() {
    if (!profile?.address || !repoOwner || !repoName) {
      setCompareError("No GitHub repo linked to this project. Use 'Commit' to select a repo.");
      return;
    }

    setComparing(true);
    setCompareError(null);
    try {
      const localFiles = files.map((f) => ({ path: f.path, content: f.content }));
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: profile.address,
          owner: repoOwner,
          repo: repoName,
          branch: "main",
          localFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompareError(data.error || "Failed to compare files");
        setCompareResult(null);
      } else {
        setCompareResult(data);
      }
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Failed to compare");
    } finally {
      setComparing(false);
    }
  }

  function handleConnectGithub() {
    if (!profile?.address) return;
    connectGithubPopup();
  }

  // Not connected state — show CTA
  if (!githubConnected) {
    return (
      <div className="flex h-full flex-col bg-[var(--surface-panel)]">
        <div className="px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Source Control
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <Github size={28} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <h4 className="text-[12px] font-medium text-[var(--text-primary)] mb-1">
            Connect GitHub
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mb-4 max-w-xs leading-relaxed">
            Commit changes, import repos, and sync across devices.
          </p>
          <Button
            size="sm"
            onClick={handleConnectGithub}
            disabled={!profile || oauthConnecting}
            className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
          >
            {oauthConnecting ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Github size={13} strokeWidth={1.75} />
            )}
            {oauthConnecting ? "Connecting…" : "Connect GitHub"}
          </Button>
          {!profile && (
            <p className="mt-2 text-[10px] text-[var(--status-warning)]">
              You must be logged in first.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Connected state — show sync status + commit button
  return (
    <div className="relative flex h-full flex-col bg-[var(--surface-panel)] overflow-y-auto">
      <LoadingOverlay
        visible={comparing}
        message="Comparing files…"
        submessage="Checking for conflicts with the GitHub repo"
      />

      <div className="px-3 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Source Control
        </span>
        <Button
          size="sm"
          onClick={() => setCommitModalOpen(true)}
          disabled={!profile || files.length === 0}
          className="h-6 gap-1 text-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50 px-2"
        >
          <GitCommit size={11} strokeWidth={1.75} />
          Commit
        </Button>
      </div>

      {/* GitHub connection status */}
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-[var(--status-success)]/30 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
        <Github size={12} strokeWidth={1.75} className="shrink-0 text-[var(--status-success)]" />
        <span className="truncate">
          <span className="font-medium text-[var(--text-primary)]">{githubUsername}</span>
        </span>
      </div>

      {/* Linked repo info */}
      {repoOwner && repoName ? (
        <div className="mx-3 mb-2 rounded-md bg-[var(--surface-sunken)] px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
            Linked repo
          </div>
          <div className="text-[11px] font-mono text-[var(--text-primary)] truncate">
            {repoOwner}/{repoName}
          </div>
          <button
            onClick={handleCompare}
            disabled={comparing}
            className="mt-1 flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {comparing ? (
              <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <GitCommit size={10} strokeWidth={1.75} />
            )}
            {comparing ? "Comparing…" : "Check sync status"}
          </button>
        </div>
      ) : (
        <div className="mx-3 mb-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
            No repo linked
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mb-1">
            This project isn&apos;t connected to a GitHub repo yet.
          </div>
          <button
            onClick={() => setCommitModalOpen(true)}
            className="text-[10px] text-[var(--accent)] hover:underline"
          >
            Select a repo to commit to →
          </button>
        </div>
      )}

      {/* Compare result */}
      {compareError && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-2 text-[11px] text-[var(--text-secondary)]">
          <AlertCircle size={12} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
          <span>{compareError}</span>
        </div>
      )}

      {compareResult && (
        <div className="mx-3 mb-2 space-y-2">
          {/* Summary */}
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2">
            <div className="flex items-center gap-2 mb-2">
              {compareResult.hasConflicts ? (
                <AlertCircle size={11} strokeWidth={1.75} className="text-[var(--status-warning)]" />
              ) : compareResult.hasChanges ? (
                <Check size={11} strokeWidth={2} className="text-[var(--status-success)]" />
              ) : (
                <Check size={11} strokeWidth={2} className="text-[var(--text-muted)]" />
              )}
              <span className="text-[11px] font-medium text-[var(--text-primary)]">
                {compareResult.hasConflicts
                  ? "Conflicts detected"
                  : compareResult.hasChanges
                  ? "Changes ready"
                  : "In sync"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[13px] font-mono font-semibold text-[var(--status-success)]">
                  {compareResult.summary.added}
                </div>
                <div className="text-[8px] uppercase text-[var(--text-muted)]">Add</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[13px] font-mono font-semibold text-[var(--status-warning)]">
                  {compareResult.summary.modified}
                </div>
                <div className="text-[8px] uppercase text-[var(--text-muted)]">Mod</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[13px] font-mono font-semibold text-[var(--status-error)]">
                  {compareResult.summary.deleted}
                </div>
                <div className="text-[8px] uppercase text-[var(--text-muted)]">Del</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[13px] font-mono font-semibold text-[var(--text-muted)]">
                  {compareResult.summary.unchanged}
                </div>
                <div className="text-[8px] uppercase text-[var(--text-muted)]">Same</div>
              </div>
            </div>
          </div>

          {/* File lists */}
          {compareResult.files.added.length > 0 && (
            <FileList label="Added" files={compareResult.files.added} color="var(--status-success)" letter="A" />
          )}
          {compareResult.files.modified.length > 0 && (
            <FileList label="Modified" files={compareResult.files.modified.map((f) => f.path)} color="var(--status-warning)" letter="M" />
          )}
          {compareResult.files.deleted.length > 0 && (
            <FileList label="Deleted" files={compareResult.files.deleted} color="var(--status-error)" letter="D" />
          )}
        </div>
      )}

      {/* Project files count */}
      {!compareResult && !comparing && files.length > 0 && (
        <div className="mx-3 text-[10px] text-[var(--text-muted)]">
          {files.length} files in project
        </div>
      )}

      <CommitToGithubModal open={commitModalOpen} onClose={() => setCommitModalOpen(false)} />
    </div>
  );
}

function FileList({
  label,
  files,
  color,
  letter,
}: {
  label: string;
  files: string[];
  color: string;
  letter: string;
}) {
  return (
    <div>
      <h4 className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
        {label} ({files.length})
      </h4>
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {files.map((path) => (
          <div
            key={path}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
          >
            <span className="font-mono text-[9px] w-3 shrink-0" style={{ color }}>
              {letter}
            </span>
            <span className="truncate">{path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
