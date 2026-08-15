"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useCollabStore } from "@/stores/collab-store";
import { useProfileStore } from "@/stores/profile-store";
import { Loader2, AlertCircle, Check } from "lucide-react";

/**
 * /shared/[token] — Share link receiver page.
 *
 * When a user opens a share link:
 * 1. Verify access via /api/share/access?token=<token>
 * 2. If access granted, redirect to the IDE with the room ID in the URL hash
 * 3. The IDE auto-joins the collab session on mount
 * 4. If access denied, show a "You need to be invited" page
 */

export default function SharedProjectPage() {
  const params = useParams();
  const token = params.token as string;
  const [status, setStatus] = useState<"checking" | "granted" | "denied" | "error">("checking");
  const [projectInfo, setProjectInfo] = useState<{ name: string; ownerName: string } | null>(null);
  const profile = useProfileStore((s) => s.profile);
  const walletConnected = useProfileStore((s) => s.walletConnected);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/access?token=${encodeURIComponent(token)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.hasAccess) {
          setProjectInfo({
            name: data.projectName ?? "Shared Project",
            ownerName: data.ownerUsername ?? "Unknown",
          });
          setStatus("granted");
        } else {
          setStatus("denied");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  // Auto-join collab session when access is granted + user is logged in
  useEffect(() => {
    if (status === "granted" && profile && !useCollabStore.getState().connected) {
      useCollabStore.getState().joinSession(token, {
        name: profile.username || "Anonymous",
        color: useProfileStore.getState().accentColor,
      });
      // Redirect to the main IDE page (which will auto-detect the room in the URL hash)
      setTimeout(() => {
        window.location.href = `/#room=${token}`;
      }, 1500);
    }
  }, [status, profile, token]);

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface-app)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-muted)]">Verifying access…</span>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface-app)]">
        <div className="flex flex-col items-center gap-3 text-center max-w-md px-6">
          <AlertCircle size={48} strokeWidth={1.5} className="text-[var(--status-warning)]" />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Access Denied</h1>
          <p className="text-sm text-[var(--text-muted)]">
            This share link is no longer valid, or you don&apos;t have permission to access this project.
            Ask the project owner to invite you.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface-app)]">
        <div className="flex flex-col items-center gap-3 text-center max-w-md px-6">
          <AlertCircle size={48} strokeWidth={1.5} className="text-[var(--status-error)]" />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Something went wrong</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Failed to verify access. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Access granted
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--surface-app)]">
      <div className="flex flex-col items-center gap-3 text-center max-w-md px-6">
        <Check size={48} strokeWidth={1.5} className="text-[var(--status-success)]" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Access Granted
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          You have access to <span className="font-medium text-[var(--text-primary)]">{projectInfo?.name}</span>
          {" "}by <span className="font-medium text-[var(--text-primary)]">{projectInfo?.ownerName}</span>
        </p>
        {!walletConnected ? (
          <div className="mt-4 rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-3 text-xs text-[var(--text-secondary)]">
            Connect your wallet to join the collaboration session.
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 text-xs text-[var(--accent)]">
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            <span>Joining collaboration session…</span>
          </div>
        )}
      </div>
    </div>
  );
}
