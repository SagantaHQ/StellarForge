"use client";

import { useState, useEffect } from "react";
import {
  X,
  Copy,
  Check,
  Link2,
  Users,
  LogOut,
  UserPlus,
  Globe,
  Lock,
  Trash2,
  Eye,
  Edit3,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useProfileStore } from "@/stores/profile-store";
import { useProjectsStore } from "@/stores/projects-store";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

interface SharePermission {
  id: string;
  shareType: string;
  shareToken: string | null;
  guestUsername: string | null;
  role: string;
  sharedToUsername: string | null;
  sharedToAvatar: string | null;
  createdAt: string;
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const [mode, setMode] = useState<"public" | "private">("public");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [guestUsername, setGuestUsername] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shares, setShares] = useState<SharePermission[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);

  const profile = useProfileStore((s) => s.profile);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  // Default to the active project
  useEffect(() => {
    if (open && !selectedProjectId && activeProjectId) {
      const active = projects.find((p) => p.id === activeProjectId);
      if (active?.serverProjectId) {
        setSelectedProjectId(active.serverProjectId);
      }
    }
  }, [open, activeProjectId, projects, selectedProjectId]);

  // Fetch existing shares when project changes
  useEffect(() => {
    if (open && selectedProjectId) {
      fetchShares();
    } else {
      setShares([]);
    }
  }, [open, selectedProjectId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setError(null);
      setSuccess(null);
      setGuestUsername("");
    }
  }, [open]);

  async function fetchShares() {
    if (!selectedProjectId) return;
    setLoadingShares(true);
    try {
      const res = await fetch(`/api/share/list?projectId=${selectedProjectId}`);
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingShares(false);
    }
  }

  async function handleCreateShare() {
    if (!profile?.address || !selectedProjectId) {
      setError("You must be logged in and have a project selected.");
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      // Get owner ID from server session
      const sessionRes = await fetch(`/api/auth/session?address=${encodeURIComponent(profile.address)}`);
      const sessionData = await sessionRes.json();
      if (!sessionData?.loggedIn || !sessionData?.user?.id) {
        setError("You must be logged in to share.");
        setCreating(false);
        return;
      }

      const res = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          ownerId: sessionData.user.id,
          mode,
          role,
          guestUsername: mode === "private" ? guestUsername.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create share");
        setCreating(false);
        return;
      }

      if (mode === "public" && data.shareUrl) {
        const fullUrl = `${window.location.origin}/shared/${data.shareToken}`;
        navigator.clipboard.writeText(fullUrl).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        setSuccess("Public link created and copied to clipboard!");
      } else {
        setSuccess(`Invited ${guestUsername.trim()} as ${role.toLowerCase()}`);
        setGuestUsername("");
      }

      await fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(shareId: string) {
    if (!profile?.address) return;
    try {
      const sessionRes = await fetch(`/api/auth/session?address=${encodeURIComponent(profile.address)}`);
      const sessionData = await sessionRes.json();
      if (!sessionData?.user?.id) return;

      await fetch("/api/share/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, ownerId: sessionData.user.id }),
      });

      await fetchShares();
    } catch {
      // ignore
    }
  }

  function copyShareUrl(token: string) {
    const url = `${window.location.origin}/shared/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  // Gate: must be logged in
  if (!profile) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-6 text-center shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-[var(--text-secondary)] mb-2">Login required</p>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Connect your wallet to share projects with collaborators.
          </p>
          <Button onClick={onClose} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]">
            Close
          </Button>
        </div>
      </div>
    );
  }

  const shareableProjects = projects.filter((p) => p.serverProjectId);
  const selectedProject = projects.find((p) => p.serverProjectId === selectedProjectId);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share project"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 sticky top-0 bg-[var(--surface-panel)] z-10">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Share Project</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Project selector */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
              Project to share
            </label>
            <button
              onClick={() => setProjectSelectorOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <span className="truncate">
                {selectedProject ? selectedProject.name : "Select a project…"}
              </span>
              {projectSelectorOpen ? (
                <ChevronDown size={14} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
              ) : (
                <ChevronRight size={14} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
              )}
            </button>
            {projectSelectorOpen && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {shareableProjects.length === 0 && (
                  <div className="px-3 py-3 text-[11px] text-[var(--text-muted)] text-center">
                    No synced projects. Create or sync a project first.
                  </div>
                )}
                {shareableProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProjectId(p.serverProjectId);
                      setProjectSelectorOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors",
                      selectedProjectId === p.serverProjectId
                        ? "bg-[var(--accent-subtle)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.serverProjectId && (
                      <span className="ml-auto text-[9px] text-[var(--text-muted)]">synced</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProjectId && (
            <>
              {/* Mode selection */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
                  Sharing mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode("public")}
                    className={cn(
                      "flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                      mode === "public"
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    )}
                  >
                    <Globe size={14} strokeWidth={1.75} className={mode === "public" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    <div>
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">Public link</div>
                      <div className="text-[10px] text-[var(--text-muted)]">Anyone with the URL</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setMode("private")}
                    className={cn(
                      "flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                      mode === "private"
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    )}
                  >
                    <Lock size={14} strokeWidth={1.75} className={mode === "private" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    <div>
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">Private invite</div>
                      <div className="text-[10px] text-[var(--text-muted)]">By username</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Role selection */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
                  Permission
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setRole("VIEWER")}
                    className={cn(
                      "flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                      role === "VIEWER"
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    )}
                  >
                    <Eye size={14} strokeWidth={1.75} className={role === "VIEWER" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    <div>
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">Viewer</div>
                      <div className="text-[10px] text-[var(--text-muted)]">Read-only + comments</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setRole("EDITOR")}
                    className={cn(
                      "flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                      role === "EDITOR"
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    )}
                  >
                    <Edit3 size={14} strokeWidth={1.75} className={role === "EDITOR" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    <div>
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">Editor</div>
                      <div className="text-[10px] text-[var(--text-muted)]">Full edit + comments</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Private mode — username input */}
              {mode === "private" && (
                <div>
                  <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1 block">
                    Guest username
                  </label>
                  <input
                    value={guestUsername}
                    onChange={(e) => setGuestUsername(e.target.value)}
                    placeholder="username"
                    className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
              )}

              {/* Create button */}
              <Button
                onClick={handleCreateShare}
                disabled={creating || (mode === "private" && !guestUsername.trim())}
                className="w-full gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
                ) : mode === "public" ? (
                  <Link2 size={14} strokeWidth={1.75} />
                ) : (
                  <UserPlus size={14} strokeWidth={1.75} />
                )}
                {creating
                  ? "Creating…"
                  : mode === "public"
                  ? "Create share link"
                  : `Invite ${guestUsername.trim() || "user"}`}
              </Button>

              {/* Success message */}
              {success && (
                <div className="flex items-center gap-2 rounded-md border border-[var(--status-success)]/40 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-success)]">
                  <Check size={12} strokeWidth={2} />
                  <span>{success}</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
                  <X size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Existing shares */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  Active shares ({shares.length})
                </h3>
                {loadingShares && (
                  <div className="flex items-center justify-center py-3 text-[11px] text-[var(--text-muted)]">
                    <Loader2 size={12} strokeWidth={1.75} className="animate-spin mr-1" />
                    Loading…
                  </div>
                )}
                {!loadingShares && shares.length === 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] italic py-2">
                    No active shares for this project.
                  </div>
                )}
                <div className="space-y-1">
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5"
                    >
                      {/* Type icon */}
                      {share.shareType === "PUBLIC_LINK" ? (
                        <Globe size={12} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                      ) : (
                        <Users size={12} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                      )}

                      {/* Name/URL */}
                      <div className="min-w-0 flex-1">
                        {share.shareType === "PUBLIC_LINK" ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                              {share.shareToken?.substring(0, 20)}…
                            </span>
                            <button
                              onClick={() => share.shareToken && copyShareUrl(share.shareToken)}
                              className="text-[var(--accent)] hover:underline text-[9px]"
                            >
                              {copied ? "copied!" : "copy"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-[var(--text-primary)]">
                            {share.sharedToUsername || share.guestUsername}
                          </span>
                        )}
                      </div>

                      {/* Role badge */}
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                          share.role === "EDITOR"
                            ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                            : "bg-[var(--surface-raised)] text-[var(--text-muted)]"
                        )}
                      >
                        {share.role === "EDITOR" ? "Editor" : "Viewer"}
                      </span>

                      {/* Revoke */}
                      <button
                        onClick={() => handleRevoke(share.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--status-error)] shrink-0"
                        title="Revoke access"
                      >
                        <Trash2 size={11} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!selectedProjectId && (
            <div className="text-center py-4 text-[11px] text-[var(--text-muted)]">
              Select a project above to start sharing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
