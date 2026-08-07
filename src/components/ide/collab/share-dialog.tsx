"use client";

import { useState, useEffect, useRef } from "react";
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
  Search,
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

interface UserSearchResult {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

type Tab = "invite" | "sessions";

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const [tab, setTab] = useState<Tab>("invite");
  const [mode, setMode] = useState<"public" | "private">("public");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [guestInput, setGuestInput] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shares, setShares] = useState<SharePermission[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profile = useProfileStore((s) => s.profile);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  useEffect(() => {
    if (open && !selectedProjectId && activeProjectId) {
      const active = projects.find((p) => p.id === activeProjectId);
      if (active?.serverProjectId) setSelectedProjectId(active.serverProjectId);
    }
  }, [open, activeProjectId, projects, selectedProjectId]);

  useEffect(() => {
    if (open && selectedProjectId) fetchShares();
    else setShares([]);
  }, [open, selectedProjectId]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSuccess(null);
      setGuestInput("");
      setGuests([]);
      setSearchResults([]);
    }
  }, [open]);

  // Username autocomplete — debounced search
  useEffect(() => {
    if (mode !== "private" || !guestInput.trim() || guestInput.trim().length < 1) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(guestInput.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.users || []);
          setShowSearchDropdown(true);
        }
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [guestInput, mode]);

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

  function addGuest(username: string) {
    const clean = username.trim().toLowerCase();
    if (!clean || guests.includes(clean)) return;
    setGuests([...guests, clean]);
    setGuestInput("");
    setSearchResults([]);
    setShowSearchDropdown(false);
  }

  function removeGuest(username: string) {
    setGuests(guests.filter((g) => g !== username));
  }

  async function handleCreateShare() {
    if (!profile?.address || !selectedProjectId) {
      setError("You must be logged in and have a project selected.");
      return;
    }
    if (mode === "private" && guests.length === 0) {
      setError("Add at least one guest username.");
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const sessionRes = await fetch(`/api/auth/session?address=${encodeURIComponent(profile.address)}`);
      const sessionData = await sessionRes.json();
      if (!sessionData?.loggedIn || !sessionData?.user?.id) {
        setError("You must be logged in to share.");
        setCreating(false);
        return;
      }

      if (mode === "public") {
        const res = await fetch("/api/share/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProjectId,
            ownerId: sessionData.user.id,
            mode: "public",
            role,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to create share");
          setCreating(false);
          return;
        }
        const fullUrl = `${window.location.origin}/shared/${data.shareToken}`;
        navigator.clipboard.writeText(fullUrl).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        setSuccess("Public link created and copied to clipboard!");
      } else {
        // Private — invite each guest
        const results: { username: string; success: boolean; error?: string }[] = [];
        for (const guest of guests) {
          const res = await fetch("/api/share/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: selectedProjectId,
              ownerId: sessionData.user.id,
              mode: "private",
              role,
              guestUsername: guest,
            }),
          });
          const data = await res.json();
          results.push({
            username: guest,
            success: res.ok,
            error: res.ok ? undefined : data.error,
          });
        }
        const succeeded = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);
        if (succeeded.length > 0) {
          setSuccess(`Invited ${succeeded.length} guest${succeeded.length > 1 ? "s" : ""} as ${role.toLowerCase()}`);
        }
        if (failed.length > 0) {
          setError(`Failed: ${failed.map((f) => `${f.username} (${f.error})`).join(", ")}`);
        }
        setGuests([]);
      }
      await fetchShares();
      setTab("sessions");
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

  if (!profile) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <Users size={28} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)] mb-2">Login required</p>
          <p className="text-xs text-[var(--text-muted)] mb-4">Connect your wallet to start collaborating.</p>
          <Button onClick={onClose} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]">Close</Button>
        </div>
      </div>
    );
  }

  const shareableProjects = projects.filter((p) => p.serverProjectId);
  const selectedProject = projects.find((p) => p.serverProjectId === selectedProjectId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Live Collab">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 sticky top-0 bg-[var(--surface-panel)] z-10">
          <div className="flex items-center gap-2">
            <Users size={16} strokeWidth={1.75} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Live Collab</h2>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
          <TabButton active={tab === "invite"} onClick={() => setTab("invite")} icon={UserPlus} label="Invite" />
          <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")} icon={Users} label={`Sessions${shares.length > 0 ? ` (${shares.length})` : ""}`} />
        </div>

        <div className="p-4 space-y-4">
          {/* Project selector (shared across both tabs) */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">Project</label>
            <button onClick={() => setProjectSelectorOpen((v) => !v)} className="flex w-full items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:border-[var(--border-strong)]">
              <span className="truncate">{selectedProject ? selectedProject.name : "Select a project…"}</span>
              {projectSelectorOpen ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
            </button>
            {projectSelectorOpen && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {shareableProjects.length === 0 && <div className="px-3 py-3 text-[11px] text-[var(--text-muted)] text-center">No synced projects. Create or sync a project first.</div>}
                {shareableProjects.map((p) => (
                  <button key={p.id} onClick={() => { setSelectedProjectId(p.serverProjectId); setProjectSelectorOpen(false); }} className={cn("flex w-full items-center px-3 py-2 text-left text-[12px]", selectedProjectId === p.serverProjectId ? "bg-[var(--accent-subtle)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]")}>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === "invite" && selectedProjectId && (
            <>
              {/* Mode selection */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <ModeCard active={mode === "public"} onClick={() => setMode("public")} icon={Globe} title="Public link" desc="Anyone with URL" />
                  <ModeCard active={mode === "private"} onClick={() => setMode("private")} icon={Lock} title="Private invite" desc="By username" />
                </div>
              </div>

              {/* Role selection */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">Permission</label>
                <div className="grid grid-cols-2 gap-2">
                  <ModeCard active={role === "VIEWER"} onClick={() => setRole("VIEWER")} icon={Eye} title="Viewer" desc="Read + comments" />
                  <ModeCard active={role === "EDITOR"} onClick={() => setRole("EDITOR")} icon={Edit3} title="Editor" desc="Edit + comments" />
                </div>
              </div>

              {/* Private mode — multi-guest with autocomplete */}
              {mode === "private" && (
                <div>
                  <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1 block">Guest usernames</label>
                  {/* Selected guests */}
                  {guests.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {guests.map((g) => (
                        <span key={g} className="flex items-center gap-1 rounded-full bg-[var(--accent-subtle)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                          {g}
                          <button onClick={() => removeGuest(g)} className="hover:text-[var(--status-error)]">
                            <X size={9} strokeWidth={2} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Search input */}
                  <div className="relative">
                    <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
                      <Search size={12} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        value={guestInput}
                        onChange={(e) => setGuestInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (searchResults.length > 0) addGuest(searchResults[0].username);
                            else if (guestInput.trim()) addGuest(guestInput);
                          }
                          if (e.key === "Backspace" && !guestInput && guests.length > 0) {
                            setGuests(guests.slice(0, -1));
                          }
                        }}
                        placeholder="Search usernames…"
                        className="flex-1 bg-transparent text-[12px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                      />
                      {searchLoading && <Loader2 size={11} className="animate-spin text-[var(--text-muted)]" />}
                    </div>
                    {/* Autocomplete dropdown */}
                    {showSearchDropdown && searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-20 max-h-40 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-lg">
                        {searchResults.map((u) => (
                          <button
                            key={u.username}
                            onClick={() => addGuest(u.username)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                          >
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt={u.username} className="h-5 w-5 rounded-full" />
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-[var(--surface-raised)] flex items-center justify-center text-[9px] text-[var(--text-muted)]">
                                {u.username.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="text-[11px] font-mono text-[var(--text-primary)]">{u.username}</span>
                            {u.displayName && <span className="text-[10px] text-[var(--text-muted)] truncate">{u.displayName}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">Type to search, press Enter or click to add. All usernames are verified against the database.</p>
                </div>
              )}

              {/* Create button */}
              <Button onClick={handleCreateShare} disabled={creating || (mode === "private" && guests.length === 0)} className="w-full gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50">
                {creating ? <Loader2 size={14} className="animate-spin" /> : mode === "public" ? <Link2 size={14} /> : <UserPlus size={14} />}
                {creating ? "Creating…" : mode === "public" ? "Create share link" : `Invite ${guests.length > 0 ? `${guests.length} guest${guests.length > 1 ? "s" : ""}` : "guests"}`}
              </Button>

              {success && <div className="flex items-center gap-2 rounded-md border border-[var(--status-success)]/40 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-success)]"><Check size={12} /><span>{success}</span></div>}
              {error && <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]"><X size={12} className="shrink-0 mt-0.5" /><span>{error}</span></div>}
            </>
          )}

          {tab === "sessions" && (
            <>
              {loadingShares && <div className="flex items-center justify-center py-4 text-[11px] text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin mr-1" />Loading…</div>}
              {!loadingShares && shares.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Users size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
                  <p className="text-[11px] text-[var(--text-muted)]">No active share sessions.<br />Use the Invite tab to start sharing.</p>
                </div>
              )}
              <div className="space-y-1.5">
                {shares.map((share) => (
                  <div key={share.id} className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                    {share.shareType === "PUBLIC_LINK" ? <Globe size={13} className="text-[var(--text-muted)] shrink-0" /> : <Users size={13} className="text-[var(--text-muted)] shrink-0" />}
                    <div className="min-w-0 flex-1">
                      {share.shareType === "PUBLIC_LINK" ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{share.shareToken?.substring(0, 24)}…</span>
                          <button onClick={() => share.shareToken && copyShareUrl(share.shareToken)} className="text-[var(--accent)] hover:underline text-[9px]">{copied ? "copied!" : "copy"}</button>
                        </div>
                      ) : (
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">{share.sharedToUsername || share.guestUsername}</span>
                      )}
                    </div>
                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide", share.role === "EDITOR" ? "bg-[var(--accent-subtle)] text-[var(--accent)]" : "bg-[var(--surface-raised)] text-[var(--text-muted)]")}>{share.role === "EDITOR" ? "Editor" : "Viewer"}</span>
                    <button onClick={() => handleRevoke(share.id)} className="text-[var(--text-muted)] hover:text-[var(--status-error)] shrink-0" title="Revoke access"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            </>
          )}

          {!selectedProjectId && (
            <div className="text-center py-4 text-[11px] text-[var(--text-muted)]">Select a project above to start collaborating.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Users; label: string }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors", active ? "bg-[var(--surface-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]")}>
      <Icon size={12} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function ModeCard({ active, onClick, icon: Icon, title, desc }: { active: boolean; onClick: () => void; icon: typeof Globe; title: string; desc: string }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors", active ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]")}>
      <Icon size={14} strokeWidth={1.75} className={active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
      <div>
        <div className="text-[12px] font-medium text-[var(--text-primary)]">{title}</div>
        <div className="text-[10px] text-[var(--text-muted)]">{desc}</div>
      </div>
    </button>
  );
}
