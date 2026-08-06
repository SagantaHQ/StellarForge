"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Download,
  GitBranch,
  FileArchive,
  FolderOpen,
  Loader2,
  Check,
  AlertCircle,
  FileCode2,
  ArrowRight,
  Github,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  validateSorobanProject,
  formatValidationResult,
  type ValidationResult,
  type ImportedFile,
} from "@/lib/soroban/validate-project";

interface ImportProjectModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (
    projectName: string,
    files: ImportedFile[]
  ) => Promise<void>;
}

type ImportTab = "github" | "zip" | "folder";

const TEXT_EXTENSIONS = new Set([
  "rs", "toml", "ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml",
  "gitignore", "env", "sh", "bash", "zsh", "py", "go", "java", "kt", "swift",
  "c", "cpp", "h", "hpp", "cs", "rb", "php", "vue", "svelte", "css", "scss",
  "html", "xml", "sql", "graphql", "gql", "proto", "wasm", "wat", "lock",
  "dockerfile", "makefile", "cmake", "gradle",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "__MACOSX", ".next", "dist", "build",
  ".cache", "vendor", ".idea", ".vscode",
]);

function detectLanguage(ext: string): string {
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

function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(filename.toLowerCase());
}

/**
 * Unified Import Project modal.
 *
 * Three tabs:
 *   - GitHub: clone from a repo URL (server-side shallow clone)
 *   - Zip: upload a .zip file (client-side JSZip extraction)
 *   - Folder: upload a folder via the File System Access API or
 *             webkitdirectory input
 *
 * All three paths:
 *   1. Collect files
 *   2. Validate the files are a Soroban project (Cargo.toml + soroban-sdk +
 *      cdylib + .rs files)
 *   3. If invalid, show errors and block import
 *   4. If valid, prompt for project name and call onImport
 */
export function ImportProjectModal({ open, onClose, onImport }: ImportProjectModalProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>("github");
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [projectName, setProjectName] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab("github");
      setFiles([]);
      setProjectName("");
      setValidation(null);
      setSubmitting(false);
      setStatus("");
      setError(null);
    }
  }, [open]);

  // Validate whenever files change
  useEffect(() => {
    if (files.length === 0) {
      setValidation(null);
      return;
    }
    const result = validateSorobanProject(files);
    setValidation(result);
    // Auto-fill project name from Cargo.toml if not already set
    if (result.projectName && !projectName.trim()) {
      setProjectName(result.projectName);
    }
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleImport() {
    const trimmedName = projectName.trim();
    if (!validation?.valid || !trimmedName || files.length === 0) return;

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
  const canImport =
    validation?.valid &&
    trimmedName.length >= 1 &&
    trimmedName.length <= 60 &&
    files.length > 0 &&
    !submitting;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Import project"
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-raised)]">
              <Download size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import project</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-subtle)] shrink-0">
          <TabButton
            active={activeTab === "github"}
            onClick={() => { setActiveTab("github"); setFiles([]); setValidation(null); setError(null); }}
            icon={Github}
            label="GitHub"
          />
          <TabButton
            active={activeTab === "zip"}
            onClick={() => { setActiveTab("zip"); setFiles([]); setValidation(null); setError(null); }}
            icon={FileArchive}
            label="Zip file"
          />
          <TabButton
            active={activeTab === "folder"}
            onClick={() => { setActiveTab("folder"); setFiles([]); setValidation(null); setError(null); }}
            icon={FolderOpen}
            label="Folder"
          />
        </div>

        {/* Body — tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === "github" && (
            <GithubTab
              files={files}
              setFiles={setFiles}
              projectName={projectName}
              setProjectName={setProjectName}
              status={status}
              setStatus={setStatus}
              error={error}
              setError={setError}
            />
          )}
          {activeTab === "zip" && (
            <ZipTab
              files={files}
              setFiles={setFiles}
              error={error}
              setError={setError}
            />
          )}
          {activeTab === "folder" && (
            <FolderTab
              files={files}
              setFiles={setFiles}
              error={error}
              setError={setError}
            />
          )}

          {/* Validation result */}
          {files.length > 0 && validation && (
            <ValidationDisplay validation={validation} fileCount={files.length} />
          )}

          {/* Project name input — only shown when validation passes */}
          {validation?.valid && (
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3 shrink-0">
          <div className="text-[10px] text-[var(--text-muted)]">
            {files.length > 0
              ? `${files.length} files found`
              : "Import from GitHub, zip, or folder"}
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
              className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <Download size={13} strokeWidth={1.75} />
              )}
              Import project
              <ArrowRight size={12} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab button
// ============================================================

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Github;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium transition-colors border-b-2",
        active
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
      )}
    >
      <Icon size={14} strokeWidth={1.75} />
      {label}
    </button>
  );
}

// ============================================================
// GitHub tab
// ============================================================

function GithubTab({
  files,
  setFiles,
  projectName,
  setProjectName,
  status,
  setStatus,
  error,
  setError,
}: {
  files: ImportedFile[];
  setFiles: (f: ImportedFile[]) => void;
  projectName: string;
  setProjectName: (n: string) => void;
  status: string;
  setStatus: (s: string) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleClone() {
    const trimmedUrl = repoUrl.trim();
    if (!trimmedUrl) return;

    setLoading(true);
    setError(null);
    setStatus("Cloning repository…");
    setFiles([]);

    try {
      // Get the user's server ID
      let ownerId: string | null = null;
      const profileState = (window as unknown as { __profileStore?: { profile: { address: string } | null } }).__profileStore;
      if (profileState?.profile?.address) {
        try {
          const res = await fetch(`/api/auth/session?address=${encodeURIComponent(profileState.profile.address)}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.loggedIn && data?.user?.id) ownerId = data.user.id;
          }
        } catch {
          // ignore
        }
      }

      if (!ownerId) {
        setError("You must be logged in to import from GitHub.");
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Cloning repository (shallow clone)…");

      const res = await fetch("/api/projects/import-git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: trimmedUrl,
          branch: branch.trim() || undefined,
          ownerId,
          projectName: projectName.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.detail || `HTTP ${res.status}`);
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Fetching imported files…");

      // Fetch the created project's files from the server
      const fileRes = await fetch(`/api/projects/${data.project.id}`);
      if (!fileRes.ok) {
        setError("Repository cloned but file fetch failed. It will appear after sync.");
        setLoading(false);
        setStatus("");
        return;
      }

      const fileData = await fileRes.json();
      const serverFiles: ImportedFile[] = (fileData.project.files ?? []).map(
        (f: { path: string; content: string; language: string }) => ({
          path: f.path,
          content: f.content,
          language: f.language,
        })
      );

      setFiles(serverFiles);
      setStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
          Repository URL
        </label>
        <div className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
          <Github size={13} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/stellar/soroban-examples"
            className="flex-1 bg-transparent text-[13px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            autoFocus
          />
        </div>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          HTTPS or SSH URL. A shallow clone (depth 1) is performed server-side.
        </p>
      </div>

      <div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5 block">
          Branch <span className="text-[var(--text-muted)] normal-case">(optional)</span>
        </label>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <Button
        size="sm"
        onClick={handleClone}
        disabled={!repoUrl.trim() || loading}
        className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <GitBranch size={13} strokeWidth={1.75} />
        )}
        Clone repository
      </Button>

      {status && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-2.5 text-[11px] text-[var(--text-secondary)]">
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin text-[var(--accent)] shrink-0" />
          <span>{status}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
          <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Zip tab
// ============================================================

function ZipTab({
  files,
  setFiles,
  error,
  setError,
}: {
  files: ImportedFile[];
  setFiles: (f: ImportedFile[]) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [zipFileName, setZipFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      setError("Please upload a .zip file");
      return;
    }

    setExtracting(true);
    setError(null);
    setZipFileName(file.name);

    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const extracted: ImportedFile[] = [];
      const entries = Object.values(zip.files);

      for (const entry of entries) {
        if (entry.dir) continue;

        const path = entry.name;
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

        if (extracted.length >= 500) {
          setError("Zip contains more than 500 files — only the first 500 will be imported.");
          break;
        }

        const filename = path.split("/").pop() ?? path;
        if (!isTextFile(filename)) continue;

        try {
          const content = await entry.async("string");
          const ext = filename.split(".").pop()?.toLowerCase() ?? "";
          extracted.push({
            path,
            content,
            language: detectLanguage(ext),
          });
        } catch {
          continue;
        }
      }

      if (extracted.length === 0) {
        setError("No text files found in the zip. Supported: .rs, .toml, .ts, .js, .json, .md, etc.");
      } else {
        setFiles(extracted);
      }
    } catch {
      setError("Failed to read the zip file. It may be corrupted or password-protected.");
    } finally {
      setExtracting(false);
    }
  }, [setFiles, setError]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 px-4 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
            : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
        )}
        onClick={() => document.getElementById("zip-file-input-import")?.click()}
      >
        {extracting ? (
          <>
            <Loader2 size={24} strokeWidth={1.75} className="animate-spin text-[var(--accent)] mb-2" />
            <span className="text-[12px] text-[var(--text-secondary)]">Extracting…</span>
          </>
        ) : files.length > 0 ? (
          <>
            <Check size={24} strokeWidth={2} className="text-[var(--status-success)] mb-2" />
            <span className="text-[12px] font-medium text-[var(--text-primary)]">{zipFileName}</span>
            <span className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {files.length} files extracted — click to replace
            </span>
          </>
        ) : (
          <>
            <FileArchive size={24} strokeWidth={1.5} className="text-[var(--text-muted)] mb-2" />
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              Drop your .zip here, or click to browse
            </span>
            <span className="text-[10px] text-[var(--text-muted)] mt-1">
              .rs, .toml, .ts, .json, .md — max 500 files
            </span>
          </>
        )}
        <input
          id="zip-file-input-import"
          type="file"
          accept=".zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="hidden"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
          <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Folder tab
// ============================================================

function FolderTab({
  files,
  setFiles,
  error,
  setError,
}: {
  files: ImportedFile[];
  setFiles: (f: ImportedFile[]) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [reading, setReading] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null);

  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setReading(true);
    setError(null);
    setFiles([]);

    try {
      // Extract folder name from the first file's webkitRelativePath
      const firstPath = (fileList[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
      const rootFolder = firstPath?.split("/")[0] ?? "folder";
      setFolderName(rootFolder);

      const extracted: ImportedFile[] = [];
      const maxFiles = 500;

      for (let i = 0; i < fileList.length && extracted.length < maxFiles; i++) {
        const file = fileList[i] as File & { webkitRelativePath?: string };
        const relativePath = file.webkitRelativePath ?? file.name;

        // Strip the root folder prefix to get paths relative to project root
        let path = relativePath;
        if (path.startsWith(rootFolder + "/")) {
          path = path.substring(rootFolder.length + 1);
        }

        // Skip junk dirs
        const parts = path.split("/");
        if (parts.some((p) => SKIP_DIRS.has(p))) continue;

        // Skip non-text files
        const filename = path.split("/").pop() ?? path;
        if (!isTextFile(filename)) continue;

        // Skip large files (> 5 MB)
        if (file.size > 5 * 1024 * 1024) continue;

        try {
          const content = await file.text();
          const ext = filename.split(".").pop()?.toLowerCase() ?? "";
          extracted.push({
            path,
            content,
            language: detectLanguage(ext),
          });
        } catch {
          // Binary or unreadable — skip
          continue;
        }
      }

      if (extracted.length === 0) {
        setError("No text files found in the selected folder.");
      } else {
        setFiles(extracted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read folder");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--border-subtle)] py-10 px-4 text-center transition-colors hover:border-[var(--border-strong)] cursor-pointer"
        onClick={() => document.getElementById("folder-input-import")?.click()}
      >
        {reading ? (
          <>
            <Loader2 size={24} strokeWidth={1.75} className="animate-spin text-[var(--accent)] mb-2" />
            <span className="text-[12px] text-[var(--text-secondary)]">Reading folder…</span>
          </>
        ) : files.length > 0 ? (
          <>
            <Check size={24} strokeWidth={2} className="text-[var(--status-success)] mb-2" />
            <span className="text-[12px] font-medium text-[var(--text-primary)]">{folderName}/</span>
            <span className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {files.length} files read — click to replace
            </span>
          </>
        ) : (
          <>
            <FolderOpen size={24} strokeWidth={1.5} className="text-[var(--text-muted)] mb-2" />
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              Select a folder to import
            </span>
            <span className="text-[10px] text-[var(--text-muted)] mt-1">
              Uses the File System Access API — all text files in the folder will be imported
            </span>
          </>
        )}
        <input
          id="folder-input-import"
          type="file"
          // @ts-expect-error — webkitdirectory is a non-standard but widely supported attribute
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderSelect}
          className="hidden"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2.5 text-[11px] text-[var(--status-error)]">
          <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Validation display
// ============================================================

function ValidationDisplay({
  validation,
  fileCount,
}: {
  validation: ValidationResult;
  fileCount: number;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        validation.valid
          ? "border-[var(--status-success)]/40 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)]"
          : "border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)]"
      )}
    >
      <div className="flex items-center gap-2">
        {validation.valid ? (
          <Check size={14} strokeWidth={2} className="text-[var(--status-success)] shrink-0" />
        ) : (
          <AlertTriangle size={14} strokeWidth={2} className="text-[var(--status-error)] shrink-0" />
        )}
        <span
          className={cn(
            "text-[12px] font-medium",
            validation.valid
              ? "text-[var(--status-success)]"
              : "text-[var(--status-error)]"
          )}
        >
          {formatValidationResult(validation)}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {fileCount} files
        </span>
      </div>

      {/* Errors */}
      {validation.errors.map((err, i) => (
        <div key={`err-${i}`} className="flex items-start gap-1.5 text-[11px] text-[var(--status-error)] pl-5">
          <span className="shrink-0">•</span>
          <span>{err}</span>
        </div>
      ))}

      {/* Warnings */}
      {validation.warnings.map((warn, i) => (
        <div key={`warn-${i}`} className="flex items-start gap-1.5 text-[11px] text-[var(--status-warning)] pl-5">
          <span className="shrink-0">⚠</span>
          <span>{warn}</span>
        </div>
      ))}

      {/* Details for valid projects */}
      {validation.valid && (
        <div className="flex flex-wrap gap-3 pt-1 text-[10px] text-[var(--text-muted)]">
          {validation.cargoTomlPath && (
            <span className="flex items-center gap-1">
              <FileCode2 size={10} strokeWidth={1.75} />
              {validation.cargoTomlPath}
            </span>
          )}
          {validation.sorobanSdkVersion && (
            <span>soroban-sdk {validation.sorobanSdkVersion}</span>
          )}
        </div>
      )}
    </div>
  );
}
