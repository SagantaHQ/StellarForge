"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
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
  Wrench,
  Loader2,
  Settings as SettingsIcon,
  UserCircle,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/stores/profile-store";
import { useProfileStore } from "@/stores/profile-store";
import { useCollabStore } from "@/stores/collab-store";
import Avatar from "boring-avatars";

interface TopBarProps {
  projectName: string;
  branch: string;
  network: string;
  collabUsers: { name: string; color: string }[];
  profile?: UserProfile | null;
  building?: boolean;
  onShare: () => void;
  onConnectWallet: () => void;
  onOpenWalletModal: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onNewProject: () => void;
  onCommandPalette: () => void;
  onBuild: () => void;
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
  building = false,
  onShare,
  onConnectWallet,
  onOpenWalletModal,
  onOpenProfile,
  onOpenSettings,
  onLogout,
  onNewProject,
  onCommandPalette,
  onBuild,
  onDeploy,
  onSwitchNetwork,
}: TopBarProps) {
  const [networkOpen, setNetworkOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const collabConnected = useCollabStore((s) => s.connected);
  const onlineUsers = useCollabStore((s) => s.users);
  const walletConnected = useProfileStore((s) => s.walletConnected);

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
            onClick={() => {}}
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

      {/* Right: collab, network, share, deploy, wallet/avatar */}
      <div className="flex items-center gap-2">
        {/* Collab avatars */}
        <div className="hidden lg:flex items-center -space-x-1.5">
          {(collabConnected ? onlineUsers : collabUsers).slice(0, 4).map((user, i) => (
            <div
              key={i}
              className="h-6 w-6 rounded-full border-2 border-[var(--surface-panel)] flex items-center justify-center text-[10px] font-medium text-white"
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {collabConnected && onlineUsers.length > 4 && (
            <div className="h-6 w-6 rounded-full border-2 border-[var(--surface-panel)] bg-[var(--surface-raised)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)]">
              +{onlineUsers.length - 4}
            </div>
          )}
          {!collabConnected && collabUsers.length === 0 && (
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
              <div className="fixed inset-0 z-40" onClick={() => setNetworkOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] py-1 shadow-lg">
                {NETWORKS.map((n) => (
                  <button
                    key={n}
                    onClick={() => { onSwitchNetwork(n); setNetworkOpen(false); }}
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
          className={cn(
            "h-8 gap-1.5 px-2.5 text-xs transition-colors",
            collabConnected
              ? "text-[var(--status-success)] hover:bg-[var(--surface-hover)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          {collabConnected ? (
            <span className="h-2 w-2 rounded-full bg-[var(--status-success)] animate-pulse" />
          ) : (
            <Share2 size={14} strokeWidth={1.75} />
          )}
          <span className="hidden sm:inline">{collabConnected ? "Live" : "Share"}</span>
        </Button>

        {/* Build + Deploy */}
        <Button
          size="sm"
          variant="outline"
          onClick={onBuild}
          disabled={building}
          className="h-8 gap-1.5 border-[var(--border-strong)] bg-[var(--surface-sunken)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] disabled:opacity-60"
          title="Build contract (soroban contract build)"
        >
          {building ? (
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <Wrench size={12} strokeWidth={1.75} />
          )}
          <span className="hidden sm:inline">{building ? "Building…" : "Build"}</span>
        </Button>

        <Button
          size="sm"
          onClick={onDeploy}
          className="h-8 gap-1.5 bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
        >
          <Play size={12} strokeWidth={2} fill="currentColor" />
          <span>Deploy</span>
        </Button>

        {/* Wallet / profile button — shows avatar ONLY if wallet connected AND server session valid */}
        {profile && walletConnected ? (
          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Account menu"
              aria-expanded={avatarMenuOpen}
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <Avatar
                  size={24}
                  name={profile.address}
                  variant="marble"
                  colors={["#4F8C8C", "#131418", "#6E7178", "#C5794B", "#7B96B3"]}
                />
              )}
              <span className="hidden md:inline max-w-[80px] truncate">{profile.username}</span>
              <ChevronDown size={10} strokeWidth={2} className="text-[var(--text-muted)]" />
            </button>

            {avatarMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAvatarMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] py-1 shadow-xl">
                  {/* Profile header */}
                  <div className="border-b border-[var(--border-subtle)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      {profile.avatarUrl ? (
                        <img src={profile.avatarUrl} alt={profile.username} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <Avatar
                          size={32}
                          name={profile.address}
                          variant="marble"
                          colors={["#4F8C8C", "#131418", "#6E7178", "#C5794B", "#7B96B3"]}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{profile.username}</div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                          {profile.address.substring(0, 8)}…{profile.address.slice(-4)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <button
                    onClick={() => { setAvatarMenuOpen(false); onOpenWalletModal(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Wallet size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                    <span>Wallet</span>
                  </button>

                  <button
                    onClick={() => { setAvatarMenuOpen(false); onOpenProfile(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <UserCircle size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                    <span>Profile</span>
                  </button>

                  <button
                    onClick={() => { setAvatarMenuOpen(false); onOpenSettings(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <SettingsIcon size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                    <span>Settings</span>
                  </button>

                  <div className="border-t border-[var(--border-subtle)] my-1" />

                  <button
                    onClick={() => { setAvatarMenuOpen(false); onLogout(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--status-error)] hover:bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] transition-colors"
                  >
                    <LogOut size={14} strokeWidth={1.75} />
                    <span>Disconnect</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Dispatch event to lazy-load the wallet mount, which will
              // open the saganta-appkit-modal after compilation
              window.dispatchEvent(new CustomEvent("soroban-connect-click"));
              // Also call the parent handler (opens modal if already mounted)
              onConnectWallet();
            }}
            className="h-8 gap-1.5 px-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Wallet size={14} strokeWidth={1.75} />
            <span className="hidden md:inline">Connect</span>
          </Button>
        )}

        {/* Mount the saganta-appkit-modal with the client from the provider */}
        <AppKitModalMount />
      </div>
    </header>
  );
}

/**
 * Lazy-mounts the <saganta-appkit-modal> ONLY when the user clicks Connect.
 * This prevents Turbopack from compiling the heavy @saganta/stellar-appkit
 * package during initial page load, which causes OOM in the 4GB sandbox.
 */
function AppKitModalMount() {
  const [shouldMount, setShouldMount] = useState(false);

  // Listen for the first "connect" click to lazy-load the wallet
  useEffect(() => {
    function handleConnectClick() {
      setShouldMount(true);
    }
    // Custom event from the Connect button
    window.addEventListener("soroban-connect-click", handleConnectClick);
    return () => window.removeEventListener("soroban-connect-click", handleConnectClick);
  }, []);

  if (!shouldMount) return null;

  // Dynamically import the wallet mount component — only compiled when clicked
  return (
    <Suspense fallback={null}>
      <LazyWalletMount />
    </Suspense>
  );
}

const LazyWalletMount = lazy(() => import("./wallet-mount").then((m) => ({ default: m.WalletMount })));
