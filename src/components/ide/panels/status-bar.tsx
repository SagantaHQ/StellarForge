"use client";

import {
  GitBranch,
  Check,
  AlertCircle,
  Bell,
  Wifi,
  Cloud,
  CloudOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
      </div>

      {/* Right side — toolchain, network, position */}
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">rustc {rustToolchain}</span>
        <span className="hidden md:inline">·</span>
        <span className="hidden md:inline">stellar-cli {stellarCliVersion}</span>
        <span className="hidden md:inline">·</span>
        <span className="capitalize">{network}</span>
        {collabCount > 0 && (
          <>
            <span>·</span>
            <span>{collabCount} collab</span>
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
