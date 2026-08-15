"use client";

import { useState, useMemo } from "react";
import {
  Plus,
  FileCode2,
  Upload,
  GitBranch,
  Sparkles,
  ArrowRight,
  Clock,
  Trash2,
  FolderOpen,
  Loader2,
  Cloud,
  HardDrive,
  AlertCircle,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { useProfileStore } from "@/stores/profile-store";

interface WelcomePageProps {
  onNewProject: () => void;
  onBrowseTemplates: () => void;
  onImportProject: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (project: ProjectMeta) => void;
}

/**
 * Welcome page — shown when no project is active.
 *
 * Layout:
 *   1. Hero greeting (personalized if logged in)
 *   2. Quick action cards: New project, Browse templates, Import zip, Import git
 *   3. Recent projects grid (if user has projects)
 *   4. Storage usage indicator (when logged in)
 *
 * This replaces the editor + build output + right panel when there's no
 * active project. The TopBar and StatusBar remain visible.
 */
export function WelcomePage({
  onNewProject,
  onBrowseTemplates,
  onImportProject,
  onOpenProject,
  onDeleteProject,
}: WelcomePageProps) {
  const projects = useProjectsStore((s) => s.projects);
  const profile = useProfileStore((s) => s.profile);
  const walletConnected = useProfileStore((s) => s.walletConnected);
  const syncingFromCloud = useProjectsStore((s) => s.syncingFromCloud);

  const greeting = useGreeting();
  const displayName = profile?.username ?? (walletConnected ? "builder" : "there");

  // Sort projects by updatedAt desc (most recent first) — already sorted in
  // the store, but we re-sort here to be safe.
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--surface-app)]">
      <div className="mx-auto max-w-5xl px-6 py-12 pb-24 sm:px-8 sm:py-16">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="mb-4 flex justify-center">
            <img
              src="/saganta-logo.png"
              alt="StellarForge"
              className="h-14 w-14 rounded-xl ring-1 ring-[var(--border-subtle)]"
              draggable={false}
            />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
            {greeting}, <span className="text-[var(--accent)]">{displayName}</span>
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)] sm:text-base">
            Build, test, and deploy Soroban smart contracts right from your browser.
          </p>
        </div>

        {/* Quick action cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            icon={Plus}
            title="New project"
            description="Start from a blank workspace or pick a template"
            onClick={onNewProject}
            accent
          />
          <ActionCard
            icon={Download}
            title="Import project"
            description="From GitHub repo, zip file, or local folder"
            onClick={onImportProject}
          />
          <ActionCard
            icon={Sparkles}
            title="Browse templates"
            description="Token, governance, DeFi, and more"
            onClick={onBrowseTemplates}
          />
        </div>

        {/* Recent projects */}
        <div className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <Clock size={14} strokeWidth={1.75} />
              {syncingFromCloud
                ? "Loading projects…"
                : sortedProjects.length > 0
                ? "Recent projects"
                : "No projects yet"}
            </h2>
            {sortedProjects.length > 0 && !syncingFromCloud && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {sortedProjects.length} {sortedProjects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>

          {syncingFromCloud ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={24} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
                <span className="text-xs text-[var(--text-muted)]">Fetching projects from cloud…</span>
              </div>
            </div>
          ) : sortedProjects.length === 0 ? (
            <EmptyState onNewProject={onNewProject} onBrowseTemplates={onBrowseTemplates} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => onOpenProject(project.id)}
                  onDelete={() => onDeleteProject(project)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Storage usage */}
        {profile && (
          <StorageIndicator projects={sortedProjects} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function useGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ActionCard({
  icon: Icon,
  title,
  description,
  onClick,
  accent,
}: {
  icon: typeof Plus;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all",
        accent
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-panel))]"
          : "border-[var(--border-subtle)] bg-[var(--surface-panel)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
          accent
            ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
            : "bg-[var(--surface-raised)] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
        )}
      >
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)] leading-relaxed">
          {description}
        </div>
      </div>
      <ArrowRight
        size={13}
        strokeWidth={1.75}
        className="text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

function EmptyState({
  onNewProject,
  onBrowseTemplates,
}: {
  onNewProject: () => void;
  onBrowseTemplates: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] py-16 px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-raised)]">
        <FolderOpen size={22} strokeWidth={1.5} className="text-[var(--text-muted)]" />
      </div>
      <h3 className="text-sm font-medium text-[var(--text-primary)]">
        Your workspace is empty
      </h3>
      <p className="mt-1 max-w-sm text-[12px] text-[var(--text-muted)] leading-relaxed">
        Create your first Soroban contract project from scratch, or start from a
        pre-built template like a token, DAO, or escrow contract.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Button
          size="sm"
          onClick={onNewProject}
          className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
        >
          <Plus size={13} strokeWidth={1.75} />
          New project
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onBrowseTemplates}
          className="gap-1.5 border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Sparkles size={13} strokeWidth={1.75} />
          Browse templates
        </Button>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectMeta;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const timeAgo = useTimeAgo(project.updatedAt);

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] cursor-pointer"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Delete button — appears on hover */}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--status-error)_15%,transparent)] hover:text-[var(--status-error)] transition-colors"
          title="Delete project"
          aria-label="Delete project"
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      )}

      {/* Icon + name */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-raised)] shrink-0">
          <FileCode2 size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--text-primary)] truncate pr-6">
            {project.name}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
            {project.slug}
          </div>
        </div>
      </div>

      {/* Description (if any) */}
      {project.description && (
        <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed mb-3">
          {project.description}
        </p>
      )}

      {/* Footer: sync status + time */}
      <div className="mt-auto flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-1.5">
          {project.serverProjectId ? (
            <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)]">
              <Cloud size={10} strokeWidth={1.75} />
              Synced
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <HardDrive size={10} strokeWidth={1.75} />
              Local only
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">{timeAgo}</span>
      </div>
    </div>
  );
}

function StorageIndicator({ projects }: { projects: ProjectMeta[] }) {
  // Estimate local storage usage — in production this would come from the server
  const localCount = projects.filter((p) => !p.serverProjectId).length;
  const syncedCount = projects.filter((p) => p.serverProjectId).length;
  const quotaGb = 1;

  return (
    <div className="mt-12 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Storage
        </h3>
        <span className="text-[10px] text-[var(--text-muted)]">
          {syncedCount} synced · {localCount} local · {quotaGb} GB quota
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <Cloud size={12} strokeWidth={1.75} className="text-[var(--status-success)]" />
        <span>
          Projects are synced to the cloud and persist across your devices. Free
          tier includes {quotaGb} GB of storage.
        </span>
      </div>
    </div>
  );
}

function useTimeAgo(timestamp: number): string {
  return useMemo(() => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) {
      return new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  }, [timestamp]);
}
