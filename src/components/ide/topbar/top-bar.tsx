"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
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
  FolderPlus,
  X,
  Trash2,
  FolderOpen,
  ChevronRight,
  Download,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/stores/profile-store";
import { useProfileStore } from "@/stores/profile-store";
import { useCollabStore } from "@/stores/collab-store";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { useWalletModal } from "@/lib/wallet/wallet-modal-host";
// Lazy-load boring-avatars (uses Math.random → causes hydration mismatch if SSR'd)
const Avatar = lazy(() => import("boring-avatars"));

interface TopBarProps {
  projectName: string;
  branch: string;
  network: string;
  collabUsers: { name: string; color: string }[];
  profile?: UserProfile | null;
  building?: boolean;
  hasBuilt?: boolean;
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
  // Project switcher handlers
  onSwitchProject?: (projectId: string) => void;
  onCloseProject?: () => void;
  onDeleteProject?: (projectId: string) => void;
  onImportProject?: () => void;
}

const NETWORKS = ["mainnet", "testnet", "futurenet", "local"] as const;

export function TopBar({
  projectName,
  branch,
  network,
  collabUsers,
  profile,
  building = false,
  hasBuilt = false,
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
  onSwitchProject,
  onCloseProject,
  onDeleteProject,
  onImportProject,
}: TopBarProps) {
  const [networkOpen, setNetworkOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const collabConnected = useCollabStore((s) => s.connected);
  const onlineUsers = useCollabStore((s) => s.users);
  const walletConnected = useProfileStore((s) => s.walletConnected);
  const walletModal = useWalletModal();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projectsBusy = useProjectsStore((s) => s.busy);

  // Resolve the displayed project name: prefer the active project from the
  // store, fall back to the prop (which is the hard-coded default).
  const activeProject: ProjectMeta | null = activeProjectId
    ? projects.find((p) => p.id === activeProjectId) ?? null
    : null;
  const displayName = activeProject?.name ?? projectName;

  return (
    <header
      className="flex h-12 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3"
      role="banner"
    >
      {/* Left: logo + project switcher */}
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
          {/* Project switcher dropdown */}
          <div className="relative">
            <button
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--accent)] transition-colors max-w-[180px]"
              title={activeProject ? `Switch project (${activeProject.name})` : "Projects"}
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              disabled={projectsBusy}
            >
              <span className="truncate">{displayName}</span>
              <ChevronDown
                size={12}
                strokeWidth={2}
                className={cn(
                  "text-[var(--text-muted)] transition-transform shrink-0",
                  projectMenuOpen && "rotate-180"
                )}
              />
            </button>

            {projectMenuOpen && (
              <ProjectSwitcherMenu
                projects={projects}
                activeProjectId={activeProjectId}
                busy={projectsBusy}
                onSwitch={(id) => {
                  setProjectMenuOpen(false);
                  onSwitchProject?.(id);
                }}
                onNewProject={() => {
                  setProjectMenuOpen(false);
                  onNewProject();
                }}
                onImportProject={() => {
                  setProjectMenuOpen(false);
                  onImportProject?.();
                }}
                onClose={() => {
                  setProjectMenuOpen(false);
                  onCloseProject?.();
                }}
                onDelete={(id) => {
                  setProjectMenuOpen(false);
                  onDeleteProject?.(id);
                }}
                onCloseMenu={() => setProjectMenuOpen(false)}
              />
            )}
          </div>
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
            <Users size={14} strokeWidth={1.75} />
          )}
          <span className="hidden sm:inline">{collabConnected ? "Live" : "Collab"}</span>
        </Button>

        {/* Build + Deploy — disabled if not logged in or not built */}
        <Button
          size="sm"
          variant="outline"
          onClick={onBuild}
          disabled={building || !profile || !walletConnected}
          className="h-8 gap-1.5 border-[var(--border-strong)] bg-[var(--surface-sunken)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] disabled:opacity-60"
          title={!profile || !walletConnected ? "Login to build" : "Build contract (stellar contract build)"}
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
          disabled={!profile || !walletConnected || !hasBuilt}
          className="h-8 gap-1.5 bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
          title={!profile || !walletConnected ? "Login to deploy" : !hasBuilt ? "Build first" : "Deploy contract"}
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
                <Suspense fallback={<div className="h-6 w-6 rounded-full bg-[var(--surface-raised)]" />}>
                  <Avatar
                    size={24}
                    name={profile.address}
                    variant="marble"
                    colors={["#4F8C8C", "#131418", "#6E7178", "#C5794B", "#7B96B3"]}
                  />
                </Suspense>
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
                        <Suspense fallback={<div className="h-8 w-8 rounded-full bg-[var(--surface-raised)]" />}>
                          <Avatar
                            size={32}
                            name={profile.address}
                            variant="marble"
                            colors={["#4F8C8C", "#131418", "#6E7178", "#C5794B", "#7B96B3"]}
                          />
                        </Suspense>
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
                    onClick={() => { setAvatarMenuOpen(false); walletModal.open(); }}
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
                    <span>Sign Out</span>
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
              // Open the <StellarAppKitModal> — mounted globally in layout.tsx.
              // The modal auto-triggers SIWS after wallet connect.
              walletModal.open();
              onConnectWallet();
            }}
            className="h-8 gap-1.5 px-2.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Wallet size={14} strokeWidth={1.75} />
            <span className="hidden md:inline">Connect</span>
          </Button>
        )}
      </div>
    </header>
  );
}

/**
 * Project switcher dropdown menu.
 *
 * Shows the list of projects (clickable to switch), plus actions:
 *   - Create new project (opens the NewProjectModal)
 *   - Close current project (saves files, sets active=null)
 *   - Delete project (opens the DeleteProjectModal with name-confirmation)
 */
function ProjectSwitcherMenu({
  projects,
  activeProjectId,
  busy,
  onSwitch,
  onNewProject,
  onImportProject,
  onClose,
  onDelete,
  onCloseMenu,
}: {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  busy: boolean;
  onSwitch: (id: string) => void;
  onNewProject: () => void;
  onImportProject: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onCloseMenu: () => void;
}) {
  const [hoveredDeleteId, setHoveredDeleteId] = useState<string | null>(null);

  return (
    <>
      {/* Click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onCloseMenu} />

      <div className="absolute left-0 top-full mt-1 z-50 w-72 max-h-[60vh] flex flex-col overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Projects
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        </div>

        {/* Project list (scrollable) */}
        <div className="flex-1 overflow-y-auto py-1">
          {projects.length === 0 && !busy && (
            <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
              No projects yet.
              <br />
              Create one to get started.
            </div>
          )}

          {busy && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-[11px] text-[var(--text-muted)]">
              <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
              <span>Working…</span>
            </div>
          )}

          {!busy &&
            projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <div
                  key={p.id}
                  className="group relative flex items-center"
                  onMouseEnter={() => setHoveredDeleteId(p.id)}
                  onMouseLeave={() => setHoveredDeleteId(null)}
                >
                  <button
                    onClick={() => onSwitch(p.id)}
                    disabled={isActive}
                    className={cn(
                      "flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors min-w-0",
                      isActive
                        ? "bg-[var(--accent-subtle)] text-[var(--text-primary)] cursor-default"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {isActive ? (
                      <Check size={12} strokeWidth={2} className="text-[var(--accent)] shrink-0" />
                    ) : (
                      <FolderOpen size={12} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                    )}
                    <span className="truncate flex-1">{p.name}</span>
                    {p.serverProjectId && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)] shrink-0"
                        title="Synced to server"
                      />
                    )}
                  </button>

                  {/* Inline delete button — appears on hover */}
                  {hoveredDeleteId === p.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p.id);
                      }}
                      className="absolute right-2 flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--status-error)_15%,transparent)] hover:text-[var(--status-error)] transition-colors"
                      title={`Delete ${p.name}`}
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 size={11} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              );
            })}
        </div>

        {/* Footer actions */}
        <div className="border-t border-[var(--border-subtle)] py-1">
          <button
            onClick={onNewProject}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <FolderPlus size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            <span>Create new project</span>
            <kbd className="ml-auto rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-muted)]">
              ⌘⇧P
            </kbd>
          </button>

          <button
            onClick={onImportProject}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Download size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            <span>Import project</span>
            <span className="ml-auto text-[9px] text-[var(--text-muted)]">GitHub · Zip · Folder</span>
          </button>

          <button
            onClick={onClose}
            disabled={!activeProjectId}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            <span>Close current project</span>
          </button>

          {activeProjectId && (
            <button
              onClick={() => onDelete(activeProjectId)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-[var(--status-error)] hover:bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] transition-colors"
            >
              <Trash2 size={14} strokeWidth={1.75} />
              <span>Delete current project</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
