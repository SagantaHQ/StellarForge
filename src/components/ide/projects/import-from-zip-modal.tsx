"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Upload,
  FileArchive,
  Loader2,
  Check,
  AlertCircle,
  FileCode2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ImportFromZipModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (
    projectName: string,
    files: { path: string; content: string; language: string }[]
  ) => Promise<void>;
}

/**
 * Import from zip modal.
 *
 * The user uploads a .zip file. We extract it client-side using JSZip,
 * filter to text-based source files, then create a new project from them.
 *
 * Rules:
 *   - User must enter a project name
 *   - Only text files are imported (we detect binary by trying to decode as UTF-8)
 *   - Common junk paths are stripped (node_modules, .git, target, __MACOSX)
 *   - Max 500 files per project (safety limit)
 */
export function ImportFromZipModal({ open, onClose, onImport }: ImportFromZipModalProps) {
  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<{ path: string; content: string; language: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [zipFileName, setZipFileName] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjectName("");
      setFiles([]);
      setDragOver(false);
      setExtracting(false);
      setError(null);
      setSubmitting(false);
      setZipFileName(null);
    }
  }, [open]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      setError("Please upload a .zip file");
      return;
    }

    setExtracting(true);
    setError(null);
    setZipFileName(file.name);

    // Pre-fill project name from zip filename (without extension)
    if (!projectName.trim()) {
      const baseName = file.name.replace(/\.zip$/i, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      setProjectName(baseName || "imported-project");
    }

    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const extracted: { path: string; content: string; language: string }[] = [];
      const entries = Object.values(zip.files);

      for (const entry of entries) {
        if (entry.dir) continue;

        const path = entry.name;
        // Skip junk paths
        if (
          path.includes("node_modules/") ||
          path.includes("/.git/") ||
          path.startsWith(".git/") ||
          path.includes("/target/") ||
          path.startsWith("target/") ||
          path.includes("__MACOSX") ||
          path.includes(".DS_Store")
        ) {
          continue;
        }

        // Safety limit
        if (extracted.length >= 500) {
          setError("Zip contains more than 500 files — only the first 500 will be imported.");
          break;
        }

        // Only import text files (detect by extension)
        const ext = path.split(".").pop()?.toLowerCase();
        if (!isTextFile(ext)) continue;

        try {
          const content = await entry.async("string");
          // Strip leading directory if it's a single-root zip (common pattern)
          const normalizedPath = stripLeadingDir(path, entries);
          extracted.push({
            path: normalizedPath,
            content,
            language: detectLanguage(ext),
          });
        } catch {
          // Binary file or decode error — skip
          continue;
        }
      }

      if (extracted.length === 0) {
        setError("No text files found in the zip. Supported: .rs, .toml, .ts, .js, .json, .md, .txt, etc.");
      } else {
        setFiles(extracted);
      }
    } catch {
      setError("Failed to read the zip file. It may be corrupted or password-protected.");
    } finally {
      setExtracting(false);
    }
  }, [projectName]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    const trimmedName = projectName.trim();
    if (!trimmedName || files.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImport(trimmedName, files);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import project");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const trimmedName = projectName.trim();
  const canImport = trimmedName.length >= 1 && trimmedName.length <= 60 && files.length > 0 && !submitting;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Import from zip"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-raised)]">
              <FileArchive size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import from zip</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Project name */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
              Project name
            </label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canImport) {
                  e.preventDefault();
                  handleImport();
                }
              }}
              placeholder="my-imported-contract"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              maxLength={60}
            />
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 px-4 text-center transition-colors cursor-pointer",
              dragOver
                ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
            )}
            onClick={() => document.getElementById("zip-file-input")?.click()}
          >
            {extracting ? (
              <>
                <Loader2 size={24} strokeWidth={1.75} className="animate-spin text-[var(--accent)] mb-2" />
                <span className="text-[12px] text-[var(--text-secondary)]">Extracting…</span>
              </>
            ) : files.length > 0 ? (
              <>
                <Check size={24} strokeWidth={2} className="text-[var(--status-success)] mb-2" />
                <span className="text-[12px] font-medium text-[var(--text-primary)]">
                  {zipFileName}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {files.length} files extracted — click to replace
                </span>
              </>
            ) : (
              <>
                <Upload size={24} strokeWidth={1.5} className="text-[var(--text-muted)] mb-2" />
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Drop your .zip here, or click to browse
                </span>
                <span className="text-[10px] text-[var(--text-muted)] mt-1">
                  .rs, .toml, .ts, .json, .md — max 500 files
                </span>
              </>
            )}
            <input
              id="zip-file-input"
              type="file"
              accept=".zip"
              onChange={handleInputChange}
              className="hidden"
            />
          </div>

          {/* Extracted files preview */}
          {files.length > 0 && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2 max-h-32 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                Files ({files.length})
              </div>
              <div className="space-y-0.5">
                {files.slice(0, 8).map((f) => (
                  <div key={f.path} className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
                    <FileCode2 size={9} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
                    <span className="truncate">{f.path}</span>
                  </div>
                ))}
                {files.length > 8 && (
                  <div className="text-[10px] text-[var(--text-muted)] pl-3.5">
                    +{files.length - 8} more files
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-2.5 text-[11px] text-[var(--text-secondary)]">
              <AlertCircle size={13} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="text-[10px] text-[var(--text-muted)]">
            {files.length > 0
              ? `${files.length} files ready to import`
              : "Upload a zip to extract files"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!canImport}
              className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <Upload size={13} strokeWidth={1.75} />
              )}
              Import
              <ArrowRight size={12} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

const TEXT_EXTENSIONS = new Set([
  "rs", "toml", "ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml",
  "gitignore", "env", "sh", "bash", "zsh", "py", "go", "java", "kt", "swift",
  "c", "cpp", "h", "hpp", "cs", "rb", "php", "vue", "svelte", "css", "scss",
  "html", "xml", "sql", "graphql", "gql", "proto", "wasm", "wat", "lock",
  "dockerfile", "makefile", "cmake", "gradle",
]);

function isTextFile(ext: string | undefined): boolean {
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

function detectLanguage(ext: string | undefined): string {
  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "toml": return "toml";
    case "md": return "markdown";
    case "yaml": case "yml": return "yaml";
    case "html": return "html";
    case "css": case "scss": return "css";
    case "py": return "python";
    case "go": return "go";
    case "sql": return "sql";
    default: return "plaintext";
  }
}

/**
 * If the zip has a single root directory (e.g. "my-project/src/lib.rs"),
 * strip the leading directory so paths are relative to the project root.
 */
function stripLeadingDir(
  path: string,
  allEntries: { name: string; dir: boolean }[]
): string {
  // Get all file paths (not directories)
  const filePaths = allEntries.filter((e) => !e.dir).map((e) => e.name);
  if (filePaths.length === 0) return path;

  // Check if all files share the same first directory component
  const firstSegments = filePaths.map((p) => p.split("/")[0]);
  const uniqueFirst = new Set(firstSegments);
  if (uniqueFirst.size === 1) {
    const leadingDir = firstSegments[0];
    // Only strip if the path starts with this directory
    if (path.startsWith(leadingDir + "/")) {
      return path.substring(leadingDir.length + 1);
    }
  }
  return path;
}
