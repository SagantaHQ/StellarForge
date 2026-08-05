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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useCollabStore,
  generateRoomId,
  getRoomIdFromUrl,
} from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [copied, setCopied] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");

  const connected = useCollabStore((s) => s.connected);
  const roomId = useCollabStore((s) => s.roomId);
  const users = useCollabStore((s) => s.users);
  const localUser = useCollabStore((s) => s.localUser);
  const joinSession = useCollabStore((s) => s.joinSession);
  const leaveSession = useCollabStore((s) => s.leaveSession);
  const profile = useProfileStore((s) => s.profile);

  if (!open) return null;

  const shareUrl = roomId
    ? `${window.location.origin}${window.location.pathname}#room=${roomId}&role=${role}`
    : window.location.href;

  async function handleCreateShareLink() {
    try {
      const newRoomId = generateRoomId();
      const user = profile
        ? { name: profile.username, color: useProfileStore.getState().accentColor }
        : { name: "Guest", color: "#4F8C8C" };
      await joinSession(newRoomId, user);
    } catch (err) {
      console.error("Failed to join collab session:", err);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleJoinFromUrl() {
    const urlRoomId = getRoomIdFromUrl();
    if (urlRoomId) {
      const user = profile
        ? { name: profile.username, color: useProfileStore.getState().accentColor }
        : { name: "Guest", color: "#4F8C8C" };
      joinSession(urlRoomId, user);
    }
  }

  const urlRoomId = typeof window !== "undefined" ? getRoomIdFromUrl() : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share project"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Share Project</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div className={cn(
            "rounded-md border p-2.5",
            connected
              ? "border-[var(--status-success)] bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)]"
              : "border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
          )}>
            <div className="flex items-center gap-2">
              {connected ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-[var(--status-success)] animate-pulse" />
                  <span className="text-xs font-medium text-[var(--status-success)]">Live session active</span>
                  <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">Room: {roomId}</span>
                </>
              ) : (
                <>
                  <Globe size={12} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                  <span className="text-xs text-[var(--text-muted)]">Not sharing — create a link to start</span>
                </>
              )}
            </div>
          </div>

          {/* Online users */}
          {connected && users.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                Online ({users.length})
              </h3>
              <div className="space-y-1">
                {users.map((u) => (
                  <div key={u.clientId} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white shrink-0"
                      style={{ backgroundColor: u.color }}
                    >
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[var(--text-primary)]">{u.name}</span>
                    {u.cursor && (
                      <span className="ml-auto text-[10px] text-[var(--text-muted)]">Ln {u.cursor.line}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Share link */}
          {connected ? (
            <div>
              <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1.5 block">Share link</label>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[11px] font-mono text-[var(--text-secondary)] outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopyLink}
                  className="flex h-7 items-center gap-1 rounded bg-[var(--accent)] px-2 text-[11px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                >
                  {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.75} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-muted)] mr-1">Default role:</span>
                {(["viewer", "editor"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors",
                      role === r
                        ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    {r === "viewer" ? <Lock size={9} strokeWidth={1.75} /> : <UserPlus size={9} strokeWidth={1.75} />}
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Button
              onClick={handleCreateShareLink}
              className="w-full gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
            >
              <Link2 size={14} strokeWidth={1.75} />
              Create share link
            </Button>
          )}

          {/* Auto-join from URL */}
          {!connected && urlRoomId && (
            <div className="rounded-md border border-[var(--accent)] bg-[var(--accent-subtle)] p-2.5">
              <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                You were invited to a collaboration session.
              </p>
              <Button
                onClick={handleJoinFromUrl}
                size="sm"
                className="w-full gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
              >
                <Users size={12} strokeWidth={1.75} />
                Join session
              </Button>
            </div>
          )}

          {/* Leave session */}
          {connected && (
            <Button
              onClick={() => { leaveSession(); onClose(); }}
              variant="outline"
              className="w-full gap-2 text-[var(--status-error)] hover:bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)]"
            >
              <LogOut size={13} strokeWidth={1.75} />
              Leave session
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
