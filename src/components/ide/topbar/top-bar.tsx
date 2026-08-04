"use client";

import { useState } from "react";
import {
  GitBranch,
  Share2,
  Wallet,
  Play,
  ChevronDown,
  Check,
  Users,
  Bell,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/stores/profile-store";

interface TopBarProps {
  projectName: string;
  branch: string;
  network: string;
  collabUsers: { name: string; color: string }[];
  profile?: UserProfile | null;
  onShare: () => void;
  onConnectWallet: () => void;
  onNewProject: () => void;
  onCommandPalette: () => void;
  onDeploy: () => void;
  onSwitchNetwork: (n: string) => void;
  onToggleMobilePanel?: () => void;
}

const NETWORKS = ["mainnet", "testnet", "futurenet", "local"] as const;

export function TopBar({
  projectName,
  branch,
  network,
  collabUsers,
  profile,
  onShare,
  onConnectWallet,
  onNewProject,
  onCommandPalette,
  onDeploy,
  onSwitchNetwork,
}: TopBarProps) {
  const [networkOpen, setNetworkOpen] = useState(false);

  return (
    <header
      className="flex h-12 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3"
      role="banner"
    >
      {/* Left: logo + project + branch */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-raised)]">
          <svg viewBox="0 0 256 256" className="h-5 w-5">
            <path
              d="M 168 80 Q 168 56 128 56 Q 88 56 88 88 Q 88 120 128 128 Q 168 136 168 168 Q 168 200 128 200 Q 88 200 88 176"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="hidden sm:flex items-center gap-2 min-w-0">
          <button
            onClick={onNewProject}
            className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--accent)] transition-colors"
            title="New project (⌘⇧P)"
          >
            {projectName}
            <Plus size={11} strokeWidth={2} className="text-[var(--text-muted)]" />
          </button>
          <span className="text-[var(--text-muted)]">·</span>
          <button
            className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => {/* branch switcher — TODO */}}
          >
            <GitBranch size={12} strokeWidth={1.75} />
            <span>{branch}</span>
          </button>
        </div>
      </div>

      {/* Center: command palette trigger */}
      <button
        onClick={onCommandPalette}
        className="hidden md:flex flex-1 max-w-md items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-colors"
        aria-label="Open command palette"
      >
        <span>Search or run a command…</span>
        <kbd className="ml-auto rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">
          ⌘K
        </kbd>
      </button>

      {/* Right: collab, network, share, deploy, wallet/profile */}
      <div className="flex items-center gap-2">
        {/* Collab avatars */}
        <div className="hidden lg:flex items-center -space-x-1.5">
          {collabUsers.slice(0, 4).map((user, i) => (
            <div
              key={i}
              className="h-6 w-6 rounded-full border-2 border-[var(--surface-panel)] flex items-center justify-center text-[10px] font-medium text-white"
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {collabUsers.length === 0 && (
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] px-1">
              <Users size={14} strokeWidth={1.75} />
            </div>
          )}
        </div>

        {/* Network selector */}
        <div className="relative">
          <button
            onClick={() => setNetworkOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
            aria-haspopup="menu"
            aria-expanded={networkOpen}
          >
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              network === "mainnet" ? "bg-[var(--status-success)]" :
              network === "testnet" ? "bg-[var(--status-warning)]" :
              network === "futurenet" ? "bg-[var(--status-info)]" :
              "bg-[var(--text-muted)]"
            )} />
            <span className="capitalize">{network}</span>
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>
          {networkOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setNetworkOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] py-1 shadow-lg">
                {NETWORKS.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      onSwitchNetwork(n);
                      setNetworkOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <span className="capitalize">{n}</span>
                    {n === network && <Check size={12} className="text-[var(--accent)]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={onShare}
          className="h-8 gap-1.5 px-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Share2 size={14} strokeWidth={1.75} />
          <span className="hidden sm:inline">Share</span>
        </Button>

        <Button
          size="sm"
          onClick={onDeploy}
          className="h-8 gap-1.5 bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
        >
          <Play size={12} strokeWidth={2} fill="currentColor" />
          <span>Deploy</span>
        </Button>

        {/* Wallet / profile button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onConnectWallet}
          className="h-8 gap-1.5 px-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {profile ? (
            <>
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-medium text-[var(--accent-contrast)]">
                  {profile.username.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="hidden md:inline">{profile.username}</span>
            </>
          ) : (
            <>
              <Wallet size={14} strokeWidth={1.75} />
              <span className="hidden md:inline">Connect</span>
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
