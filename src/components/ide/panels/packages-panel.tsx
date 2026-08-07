"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Package,
  Plus,
  Trash2,
  Loader2,
  Search,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useBuildStore } from "@/stores/build-store";
import { flattenFiles } from "@/lib/soroban/sample-project";
import {
  parseDependencies,
  addDependency,
  removeDependency,
  findCargoToml,
  type CargoDependency,
} from "@/lib/soroban/cargo-parser";

/**
 * PackagesPanel — Cargo dependency manager for the left sidebar.
 *
 * Lists all dependencies from Cargo.toml, allows adding new packages
 * and removing existing ones. When a package is added or removed, the
 * Cargo.toml file is updated in the file system store and a cargo build
 * is triggered automatically.
 */
export function PackagesPanel() {
  const tree = useFileSystemStore((s) => s.tree);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const startBuild = useBuildStore((s) => s.startBuild);
  const buildStatus = useBuildStore((s) => s.status);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newPkgName, setNewPkgName] = useState("");
  const [newPkgVersion, setNewPkgVersion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const files = flattenFiles(tree);
  const cargoFile = useMemo(() => findCargoToml(files), [files]);

  const deps = useMemo<CargoDependency[]>(() => {
    if (!cargoFile) return [];
    return parseDependencies(cargoFile.content);
  }, [cargoFile]);

  const regularDeps = deps.filter((d) => !d.dev);
  const devDeps = deps.filter((d) => d.dev);

  function handleAddPackage() {
    if (!cargoFile) {
      setError("No Cargo.toml found in this project.");
      return;
    }
    if (!newPkgName.trim()) {
      setError("Package name is required.");
      return;
    }

    const name = newPkgName.trim();
    const version = newPkgVersion.trim() || "*";

    // Update the Cargo.toml content
    const newContent = addDependency(cargoFile.content, name, version, false);
    updateFileContent(cargoFile.path, newContent);

    // Reset form
    setNewPkgName("");
    setNewPkgVersion("");
    setShowAddForm(false);
    setError(null);

    // Trigger a build
    if (buildStatus !== "building") {
      startBuild();
    }
  }

  function handleRemovePackage(name: string) {
    if (!cargoFile) return;

    const newContent = removeDependency(cargoFile.content, name);
    updateFileContent(cargoFile.path, newContent);

    // Trigger a build
    if (buildStatus !== "building") {
      startBuild();
    }
  }

  function openCargoToml() {
    if (cargoFile) {
      setActiveFile(cargoFile.path);
    }
  }

  // No Cargo.toml found
  if (!cargoFile) {
    return (
      <div className="flex h-full flex-col bg-[var(--surface-panel)]">
        <div className="px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Packages
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <Package size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            No Cargo.toml found in this project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Packages
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={openCargoToml}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="Open Cargo.toml"
          >
            <span className="text-[10px] font-mono">T</span>
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="Add package"
          >
            <Plus size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="mx-3 mb-2 rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] p-2.5 space-y-2">
          <div>
            <input
              value={newPkgName}
              onChange={(e) => setNewPkgName(e.target.value)}
              placeholder="package-name"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddPackage();
                if (e.key === "Escape") setShowAddForm(false);
              }}
            />
          </div>
          <div>
            <input
              value={newPkgVersion}
              onChange={(e) => setNewPkgVersion(e.target.value)}
              placeholder="version (e.g. 1.0.0, or * for latest)"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddPackage();
                if (e.key === "Escape") setShowAddForm(false);
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={handleAddPackage}
              disabled={!newPkgName.trim()}
              className="h-6 gap-1 text-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50 px-2"
            >
              <Plus size={10} strokeWidth={1.75} />
              Add
            </Button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-1.5 text-[10px] text-[var(--status-error)]">
          <AlertCircle size={10} strokeWidth={1.75} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Dependencies list */}
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {deps.length === 0 && !showAddForm && (
          <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
            No dependencies yet.
            <br />
            Click + to add a package.
          </div>
        )}

        {/* Regular dependencies */}
        {regularDeps.length > 0 && (
          <div className="mb-2">
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Dependencies ({regularDeps.length})
            </div>
            {regularDeps.map((dep) => (
              <DependencyRow
                key={dep.name}
                dep={dep}
                onRemove={() => handleRemovePackage(dep.name)}
              />
            ))}
          </div>
        )}

        {/* Dev dependencies */}
        {devDeps.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Dev Dependencies ({devDeps.length})
            </div>
            {devDeps.map((dep) => (
              <DependencyRow
                key={dep.name}
                dep={dep}
                onRemove={() => handleRemovePackage(dep.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Build status footer */}
      {buildStatus === "building" && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <Loader2 size={10} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
          <span>Building after package change…</span>
        </div>
      )}
    </div>
  );
}

function DependencyRow({
  dep,
  onRemove,
}: {
  dep: CargoDependency;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--surface-hover)] transition-colors">
      <Package size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
      <span className="text-[11px] font-mono text-[var(--text-primary)] truncate flex-1">
        {dep.name}
      </span>
      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
        {dep.version}
      </span>
      {confirming ? (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={onRemove}
            className="text-[9px] text-[var(--status-error)] hover:underline"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-[9px] text-[var(--text-muted)] hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--status-error)]"
          title={`Remove ${dep.name}`}
        >
          <Trash2 size={10} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
