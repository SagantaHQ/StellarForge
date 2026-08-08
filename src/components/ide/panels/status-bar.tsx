"use client";

import { useEffect, useState } from "react";
import {
  GitBranch,
  Check,
  AlertCircle,
  Bell,
  Wifi,
  Cloud,
  CloudOff,
  Users,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollabStore } from "@/stores/collab-store";

interface StatusBarProps {
  network: string;
  branch: string;
  rustToolchain: string;
  stellarCliVersion: string;
  syncStatus: "synced" | "syncing" | "offline";
  errors: number;
  warnings: number;
  cursorPos: { line: number; col: number };
  collabCount: number;
}

export function StatusBar({
  network,
  branch,
  rustToolchain,
  stellarCliVersion,
  syncStatus,
  errors,
  warnings,
  cursorPos,
  collabCount,
}: StatusBarProps) {
  const collabConnected = useCollabStore((s) => s.connected);
  const collabUsers = useCollabStore((s) => s.users);
  const activeCollabCount = collabConnected ? collabUsers.length : collabCount;

  return (
    <footer
      className="flex h-6 items-center justify-between gap-4 border-t border-[var(--border-subtle)] bg-[var(--accent)] px-3 text-[11px] text-[var(--accent-contrast)]"
      role="contentinfo"
      aria-label="Status Bar"
    >
      {/* Left side — branch, sync, errors */}
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-1 hover:bg-[var(--accent-hover)] rounded px-1 py-0.5 transition-colors">
          <GitBranch size={11} strokeWidth={1.75} />
          <span>{branch}</span>
        </button>

        <SyncIndicator status={syncStatus} />

        <button className="flex items-center gap-1 hover:bg-[var(--accent-hover)] rounded px-1 py-0.5 transition-colors">
          <Check size={11} strokeWidth={2} />
          <span>0</span>
          <AlertCircle size={11} strokeWidth={1.75} className="ml-1" />
          <span>{errors + warnings}</span>
        </button>

        <LspStatusIndicator />
      </div>

      {/* Right side — toolchain, network, position */}
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">rustc {rustToolchain}</span>
        <span className="hidden md:inline">·</span>
        <span className="hidden md:inline">stellar-cli {stellarCliVersion}</span>
        <span className="hidden md:inline">·</span>
        <span className="capitalize">{network}</span>
        {collabConnected && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Users size={9} strokeWidth={1.75} />
              {activeCollabCount} {activeCollabCount === 1 ? "user" : "users"}
            </span>
          </>
        )}
        <span>·</span>
        <span>
          Ln {cursorPos.line}, Col {cursorPos.col}
        </span>
        <button className="hover:bg-[var(--accent-hover)] rounded p-0.5 transition-colors" aria-label="Notifications">
          <Bell size={11} strokeWidth={1.75} />
        </button>
      </div>
    </footer>
  );
}

function SyncIndicator({ status }: { status: "synced" | "syncing" | "offline" }) {
  const config = {
    synced: { icon: Cloud, label: "Synced" },
    syncing: { icon: Cloud, label: "Syncing…" },
    offline: { icon: CloudOff, label: "Offline" },
  } as const;
  const { icon: Icon, label } = config[status];
  return (
    <button className="flex items-center gap-1 hover:bg-[var(--accent-hover)] rounded px-1 py-0.5 transition-colors">
      <Icon size={11} strokeWidth={1.75} className={cn(status === "syncing" && "animate-pulse")} />
      <span>{label}</span>
    </button>
  );
}

/**
 * LSP status indicator — shows the rust-analyzer connection state.
 * Reads from window.__lspStatus (set by LspManagerMount).
 */
function LspStatusIndicator() {
  const [status, setStatus] = useState<string>("disconnected");

  useEffect(() => {
    const update = () => {
      const s = (window as unknown as { __lspStatus?: string }).__lspStatus;
      setStatus(s || "disconnected");
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const config: Record<string, { label: string; spinning?: boolean; color?: string }> = {
    disconnected: { label: "rust-analyzer: off" },
    connecting: { label: "Connecting…", spinning: true },
    initializing: { label: "Initializing…", spinning: true },
    ready: { label: "rust-analyzer", color: "var(--status-success)" },
    error: { label: "LSP error", color: "var(--status-error)" },
    reconnecting: { label: "Reconnecting…", spinning: true },
  };
  const { label, spinning, color } = config[status] || config.disconnected;

  return (
    <button
      className="flex items-center gap-1 hover:bg-[var(--accent-hover)] rounded px-1 py-0.5 transition-colors"
      title={`Rust Language Server: ${status}`}
    >
      {spinning ? (
        <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
      ) : (
        <Wifi size={11} strokeWidth={1.75} style={color ? { color } : undefined} />
      )}
      <span style={color ? { color } : undefined}>{label}</span>
    </button>
  );
}
