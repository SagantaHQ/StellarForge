"use client";

import { useState, useEffect } from "react";
import {
  X,
  Github,
  Loader2,
  Check,
  AlertCircle,
  GitCommit,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useProfileStore } from "@/stores/profile-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProjectsStore } from "@/stores/projects-store";
import { useGithubOAuth } from "@/hooks/use-github-oauth";
import { LoadingOverlay } from "../ui/loading-overlay";
import { flattenFiles } from "@/lib/soroban/sample-project";

interface CommitToGithubModalProps {
  open: boolean;
  onClose: () => void;
}

interface GitHubRepoInfo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  owner: { login: string };
}

/**
 * Commit to GitHub modal.
 *
 * Allows the user to commit the current project's files to a GitHub repo.
 * Requires the user to have connected their GitHub account first.
 *
 * Flow:
 *   1. If not connected, show "Connect GitHub" CTA
 *   2. If connected, show repo selector (search + list)
 *   3. User selects a repo, enters a commit message + optional branch
 *   4. POST /api/github/commit with the current project's files
 *   5. Show success with commit URL
 */
export function CommitToGithubModal({ open, onClose }: CommitToGithubModalProps) {
  const [repos, setRepos] = useState<GitHubRepoInfo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoInfo | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [forceCommit, setForceCommit] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<{
    modified: number;
    deleted: number;
    unchanged: number;
  } | null>(null);
  // Create new repo state
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    commitUrl: string;
    commitSha: string;
    fileCount: number;
  } | null>(null);

  const githubConnected = useProfileStore((s) => s.githubConnected);
  const githubUsername = useProfileStore((s) => s.githubUsername);
  const profile = useProfileStore((s) => s.profile);
  const syncGithubStatus = useProfileStore((s) => s.syncGithubStatus);
  const disconnectGithub = useProfileStore((s) => s.disconnectGithub);
  const { connectGithub: connectGithubPopup, connecting: oauthConnecting, error: oauthError } = useGithubOAuth();

  // Surface OAuth errors from the hook into the modal's error state
  useEffect(() => {
    if (oauthError) setError(oauthError);
  }, [oauthError]);

  const tree = useFileSystemStore((s) => s.tree);
  const activeProject = useProjectsStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) ?? null : null;
  });

  useEffect(() => {
    if (open) {
      setSelectedRepo(null);
      setBranch("");
      setCommitMessage("");
      setCreateBranch(false);
      setForceCommit(false);
      setConflictWarning(null);
      setShowCreateRepo(false);
      setNewRepoName("");
      setNewRepoDesc("");
      setNewRepoPrivate(false);
      setCreatingRepo(false);
      setError(null);
      setSuccess(null);
      setRepos([]);
      // Sync GitHub status in case it changed
      syncGithubStatus();
    }
  }, [open, syncGithubStatus]);

  // Fetch repos when connected
  useEffect(() => {
    if (open && githubConnected && profile?.address && repos.length === 0) {
      fetchRepos();
    }
  }, [open, githubConnected, profile?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchRepos() {
    if (!profile?.address) return;
    setLoadingRepos(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/github/repos?walletAddress=${encodeURIComponent(profile.address)}`
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.needsConnect) {
          // Token expired — refresh status
          syncGithubStatus();
        }
        setError(data.error || data.detail || "Failed to fetch repos");
        setRepos([]);
      } else {
        setRepos(data.repos || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch repos");
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }

  function handleConnectGithub() {
    if (!profile?.address) {
      setError("You must be logged in to connect GitHub.");
      return;
    }
    // Open the OAuth flow in a popup window — the IDE stays open
    connectGithubPopup();
  }

  async function handleDisconnectGithub() {
    await disconnectGithub();
    setRepos([]);
    setSelectedRepo(null);
  }

  async function handleCreateRepo() {
    if (!profile?.address || !newRepoName.trim()) return;

    setCreatingRepo(true);
    setError(null);
    try {
      const res = await fetch("/api/github/create-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: profile.address,
          name: newRepoName.trim(),
          description: newRepoDesc.trim() || undefined,
          private: newRepoPrivate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create repo");
        setCreatingRepo(false);
        return;
      }

      // Auto-select the newly created repo
      const newRepo: GitHubRepoInfo = {
        id: data.repo.id,
        name: data.repo.name,
        full_name: data.repo.full_name,
        private: data.repo.private,
        default_branch: data.repo.default_branch,
        html_url: data.repo.html_url,
        language: "Rust",
        owner: { login: data.repo.owner.login },
      };

      // Add to the repos list + select it
      setRepos((prev) => [newRepo, ...prev]);
      setSelectedRepo(newRepo);
      setBranch(newRepo.default_branch);
      setShowCreateRepo(false);
      setNewRepoName("");
      setNewRepoDesc("");
      setNewRepoPrivate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repo");
    } finally {
      setCreatingRepo(false);
    }
  }

  async function handleCommit() {
    if (!selectedRepo || !commitMessage.trim() || !profile?.address) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const files = flattenFiles(tree).map((f) => ({
        path: f.path,
        content: f.content,
      }));

      if (files.length === 0) {
        setError("No files to commit. The project is empty.");
        setSubmitting(false);
        return;
      }

      // Conflict check: compare local files against the repo's current state.
      // If the repo has files that differ from local, warn the user before
      // committing (the commit will overwrite them).
      const targetBranch = branch.trim() || selectedRepo.default_branch;
      if (!forceCommit) {
        try {
          const compareRes = await fetch("/api/github/compare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walletAddress: profile.address,
              owner: selectedRepo.owner.login,
              repo: selectedRepo.name,
              branch: targetBranch,
              localFiles: files,
            }),
          });

          if (compareRes.ok) {
            const compareData = await compareRes.json();
            // If the repo has files that exist remotely but not locally (deleted)
            // or have different content (modified), that's a potential conflict.
            if (
              compareData.hasConflicts &&
              compareData.summary.modified > 0
            ) {
              setConflictWarning({
                modified: compareData.summary.modified,
                deleted: compareData.summary.deleted,
                unchanged: compareData.summary.unchanged,
              });
              setSubmitting(false);
              return;
            }
          }
          // If compare fails (e.g. empty repo), proceed with commit
        } catch {
          // Compare failed — proceed with commit (best-effort)
        }
      }

      const res = await fetch("/api/github/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: profile.address,
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          branch: targetBranch,
          message: commitMessage.trim(),
          files,
          createBranch,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.detail || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }

      setSuccess({
        commitUrl: data.commitUrl,
        commitSha: data.commitSha,
        fileCount: data.fileCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const filteredRepos = repos.filter((r) => {
    if (!repoSearch.trim()) return true;
    const q = repoSearch.toLowerCase();
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.language ?? "").toLowerCase().includes(q)
    );
  });

  const currentFileCount = flattenFiles(tree).length;
  const canCommit =
    selectedRepo &&
    commitMessage.trim().length >= 3 &&
    currentFileCount > 0 &&
    !submitting;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Commit to GitHub"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-raised)]">
              <GitCommit size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Commit to GitHub
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
        <div className="relative flex-1 overflow-y-auto p-4 space-y-4">
          <LoadingOverlay
            visible={submitting}
            message={forceCommit ? "Committing (force)…" : "Checking for conflicts…"}
            submessage={forceCommit ? "Pushing files to GitHub" : "Comparing local files with the repo"}
          />
          {/* Not connected — show CTA */}
          {!githubConnected && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-6 text-center">
              <Github size={28} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
              <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-1">
                Connect your GitHub account
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mb-4 max-w-xs mx-auto leading-relaxed">
                Commit your project changes directly to GitHub. Requires a
                one-time authorization.
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
          )}

          {/* Connected — show repo selector */}
          {githubConnected && !success && (
            <>
              {/* Connection status */}
              <div className="flex items-center justify-between rounded-md border border-[var(--status-success)]/30 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Check size={13} strokeWidth={2} className="text-[var(--status-success)]" />
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    Connected as <span className="font-medium text-[var(--text-primary)]">{githubUsername}</span>
                  </span>
                </div>
                <button
                  onClick={handleDisconnectGithub}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--status-error)]"
                >
                  Disconnect
                </button>
              </div>

              {/* Current project info */}
              {activeProject && (
                <div className="rounded-md bg-[var(--surface-sunken)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
                    Committing from
                  </div>
                  <div className="text-[12px] font-medium text-[var(--text-primary)]">
                    {activeProject.name}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {currentFileCount} files will be committed
                  </div>
                </div>
              )}

              {/* Repo search */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
                  Target repository
                </label>
                <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
                  <Github size={13} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                  <input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search your repos…"
                    className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    onClick={fetchRepos}
                    disabled={loadingRepos}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                    title="Refresh"
                  >
                    <RefreshCw size={12} strokeWidth={1.75} className={loadingRepos ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {/* Repo list */}
              <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {loadingRepos && (
                  <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-[var(--text-muted)]">
                    <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                    Loading repositories…
                  </div>
                )}
                {!loadingRepos && filteredRepos.length === 0 && (
                  <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">
                    {repos.length === 0 ? "No repositories found." : `No repos match "${repoSearch}"`}
                  </div>
                )}
                {!loadingRepos &&
                  filteredRepos.slice(0, 30).map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepo(repo);
                        setBranch(repo.default_branch);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                        selectedRepo?.id === repo.id
                          ? "bg-[var(--accent-subtle)]"
                          : "hover:bg-[var(--surface-hover)]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                            {repo.full_name}
                          </span>
                          {repo.private && (
                            <span className="rounded bg-[var(--status-warning)]/20 px-1 py-0 text-[9px] uppercase tracking-wide text-[var(--status-warning)] shrink-0">
                              Private
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {repo.language && <span>{repo.language}</span>}
                          <span>{repo.default_branch}</span>
                        </div>
                      </div>
                      {selectedRepo?.id === repo.id && (
                        <Check size={14} strokeWidth={2} className="text-[var(--accent)] shrink-0" />
                      )}
                    </button>
                  ))}
              </div>

              {/* Create new repo toggle */}
              {!showCreateRepo && !selectedRepo && (
                <button
                  onClick={() => setShowCreateRepo(true)}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--accent)] hover:underline"
                >
                  <Plus size={12} strokeWidth={1.75} />
                  Create a new repository
                </button>
              )}

              {/* Create new repo form */}
              {showCreateRepo && (
                <div className="rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">
                      Create new repository
                    </span>
                    <button
                      onClick={() => setShowCreateRepo(false)}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <X size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1 block">
                      Repo name
                    </label>
                    <input
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-contract"
                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1 block">
                      Description <span className="normal-case">(optional)</span>
                    </label>
                    <input
                      value={newRepoDesc}
                      onChange={(e) => setNewRepoDesc(e.target.value)}
                      placeholder="My Soroban contract"
                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRepoPrivate}
                      onChange={(e) => setNewRepoPrivate(e.target.checked)}
                      className="h-3 w-3"
                    />
                    Private repository
                  </label>
                  <Button
                    size="sm"
                    onClick={handleCreateRepo}
                    disabled={!newRepoName.trim() || creatingRepo}
                    className="w-full gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
                  >
                    {creatingRepo ? (
                      <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                    ) : (
                      <Plus size={13} strokeWidth={1.75} />
                    )}
                    {creatingRepo ? "Creating…" : "Create repository"}
                  </Button>
                </div>
              )}

              {/* Branch + commit message */}
              {selectedRepo && (
                <>
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
                      Branch
                    </label>
                    <input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder={selectedRepo.default_branch}
                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                    />
                    <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createBranch}
                        onChange={(e) => setCreateBranch(e.target.checked)}
                        className="h-3 w-3"
                      />
                      Create branch if it doesn&apos;t exist
                    </label>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
                      Commit message
                    </label>
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="feat: update contract logic"
                      rows={2}
                      className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] resize-none"
                    />
                  </div>
                </>
              )}

              {conflictWarning && (
                <div className="rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={13} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0" />
                    <span className="text-[12px] font-medium text-[var(--status-warning)]">
                      Conflicts detected
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed pl-5">
                    The repo has <span className="font-semibold">{conflictWarning.modified} modified</span> file(s)
                    {conflictWarning.deleted > 0 && (
                      <> and <span className="font-semibold">{conflictWarning.deleted} file(s)</span> that don&apos;t exist locally</>
                    )}
                    . Committing will <span className="font-semibold">overwrite</span> the remote files with your local versions.
                    {conflictWarning.unchanged > 0 && (
                      <> {conflictWarning.unchanged} file(s) are unchanged.</>
                    )}
                  </p>
                  <div className="flex items-center gap-2 pl-5">
                    <button
                      onClick={() => {
                        setForceCommit(true);
                        setConflictWarning(null);
                      }}
                      className="rounded bg-[var(--status-warning)] px-2.5 py-1 text-[10px] font-medium text-white hover:bg-[color-mix(in_srgb,var(--status-warning)_88%,black)]"
                    >
                      Force commit (overwrite remote)
                    </button>
                    <button
                      onClick={() => setConflictWarning(null)}
                      className="rounded border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
                  <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </>
          )}

          {/* Success state */}
          {success && (
            <div className="rounded-lg border border-[var(--status-success)]/40 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-6 text-center">
              <Check size={32} strokeWidth={2} className="mx-auto mb-3 text-[var(--status-success)]" />
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">
                Committed successfully
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                {success.fileCount} files committed to {selectedRepo?.full_name}
              </p>
              <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-[var(--text-secondary)] mb-4">
                <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5">
                  {success.commitSha.substring(0, 7)}
                </span>
              </div>
              <a
                href={success.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline"
              >
                <ExternalLink size={12} strokeWidth={1.75} />
                View commit on GitHub
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3 shrink-0">
            <div className="text-[10px] text-[var(--text-muted)]">
              {selectedRepo
                ? `${currentFileCount} files → ${selectedRepo.full_name}`
                : "Select a repository"}
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
              {githubConnected && (
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={!canCommit}
                  className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
                  ) : (
                    <GitCommit size={13} strokeWidth={1.75} />
                  )}
                  Commit
                  <ArrowRight size={12} strokeWidth={1.75} />
                </Button>
              )}
            </div>
          </div>
        )}

        {success && (
          <div className="flex items-center justify-end border-t border-[var(--border-subtle)] px-4 py-3 shrink-0">
            <Button
              size="sm"
              onClick={onClose}
              className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
            >
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
