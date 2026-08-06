"use client";

import { useState, useMemo, useEffect } from "react";
import {
  X,
  Search,
  Check,
  ExternalLink,
  FileCode2,
  Sparkles,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template } from "@/lib/templates/registry";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: Template, projectName: string) => void;
  onSelectBlank: (projectName: string) => void;
}

/**
 * New Project modal — template gallery + project name input.
 *
 * The user MUST enter a project name before they can create a project
 * (either from a template or blank). The name is validated client-side:
 *   - non-empty
 *   - 1–60 characters
 *   - no leading/trailing whitespace
 *
 * The slug is derived from the name server-side.
 */
export function NewProjectModal({
  open,
  onClose,
  onSelectTemplate,
  onSelectBlank,
}: NewProjectModalProps) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Template["category"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setCategoryFilter("all");
      setSelectedId(null);
      setProjectName("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    return TEMPLATES.filter((t) => {
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [query, categoryFilter]);

  if (!open) return null;

  const selectedTemplate = selectedId ? TEMPLATES.find((t) => t.id === selectedId) : null;

  // Validate project name
  const trimmedName = projectName.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 60;
  const canCreate = nameValid;

  function handleCreate() {
    if (!canCreate) return;
    if (selectedTemplate) {
      onSelectTemplate(selectedTemplate, trimmedName);
    } else {
      onSelectBlank(trimmedName);
    }
    onClose();
  }

  function handleStartBlank() {
    if (!canCreate) return;
    onSelectBlank(trimmedName);
    onClose();
  }

  // Pre-fill name from selected template (user can override)
  function prefillFromTemplate(template: Template) {
    if (!projectName.trim()) {
      setProjectName(template.name.replace(/\s+/g, "-").toLowerCase());
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
    >
      <div
        className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">New Project</h2>
            <p className="text-[11px] text-[var(--text-muted)]">
              Name your project, then start blank or pick a template
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] shrink-0"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Project name input — always visible at the top of the body */}
        <div className="border-b border-[var(--border-subtle)] px-4 py-3 bg-[var(--surface-sunken)]">
          <label className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] w-20 shrink-0">
              Project name
            </span>
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              placeholder="my-awesome-contract"
              className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-1.5 text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              maxLength={60}
            />
            {projectName && !nameValid && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--status-warning)] shrink-0">
                <AlertCircle size={11} strokeWidth={1.75} />
                1–60 chars
              </span>
            )}
            {nameValid && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)] shrink-0">
                <Check size={11} strokeWidth={2} />
                ready
              </span>
            )}
          </label>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — gallery */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Search + filters */}
            <div className="border-b border-[var(--border-subtle)] p-3 space-y-2">
              <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
                <Search size={13} strokeWidth={1.75} className="text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search templates…"
                  className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
              <div className="flex items-center gap-1">
                <FilterChip
                  active={categoryFilter === "all"}
                  onClick={() => setCategoryFilter("all")}
                >
                  All ({TEMPLATES.length})
                </FilterChip>
                {TEMPLATE_CATEGORIES.map((cat) => {
                  const count = TEMPLATES.filter((t) => t.category === cat.id).length;
                  if (count === 0) return null;
                  return (
                    <FilterChip
                      key={cat.id}
                      active={categoryFilter === cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                    >
                      {cat.label} ({count})
                    </FilterChip>
                  );
                })}
              </div>
            </div>

            {/* Template grid */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {/* Blank project card — first option */}
                <button
                  onClick={() => setSelectedId(null)}
                  className={cn(
                    "group relative overflow-hidden rounded-md border text-left transition-all",
                    selectedId === null
                      ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                      : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                  )}
                >
                  <div className="flex h-20 items-center justify-center bg-[var(--surface-sunken)]">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-raised)]">
                      <Sparkles size={18} strokeWidth={1.75} className="text-[var(--accent)]" />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                        Blank project
                      </span>
                      {selectedId === null && (
                        <Check size={13} strokeWidth={2} className="text-[var(--accent)] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                      Start from scratch with a minimal Soroban contract scaffold.
                    </p>
                  </div>
                </button>

                {filtered.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    selected={selectedId === t.id}
                    onSelect={() => {
                      setSelectedId(t.id);
                      prefillFromTemplate(t);
                    }}
                  />
                ))}
                {filtered.length === 0 && (
                  <div className="col-span-full py-12 text-center text-sm text-[var(--text-muted)]">
                    No templates match &ldquo;{query}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right — preview / details */}
          {selectedTemplate && (
            <div className="hidden lg:flex w-72 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
              <TemplatePreview template={selectedTemplate} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="text-[11px] text-[var(--text-muted)]">
            {selectedTemplate
              ? `${selectedTemplate.files.length} files will be scaffolded`
              : "Blank project — minimal scaffold (lib.rs + Cargo.toml)"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleStartBlank}
              disabled={!canCreate}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Start blank
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!canCreate}
              className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={13} strokeWidth={1.75} />
              Create project
              <ArrowRight size={12} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
      )}
    >
      {children}
    </button>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative overflow-hidden rounded-md border text-left transition-all",
        selected
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
          : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      )}
    >
      {/* Preview banner */}
      <div
        className="flex h-20 items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${template.preview.from}33, ${template.preview.to}66)`,
        }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ background: template.preview.from }}
        >
          <FileCode2 size={18} strokeWidth={1.75} className="text-white" />
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
            {template.name}
          </span>
          {selected && (
            <Check size={13} strokeWidth={2} className="text-[var(--accent)] shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
          {template.description}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {template.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function TemplatePreview({ template }: { template: Template }) {
  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {template.name}
        </h3>
        <p className="text-[11px] text-[var(--text-muted)] capitalize mt-0.5">
          {template.category} · soroban-sdk {template.sorobanSdkVersion}
        </p>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        {template.description}
      </p>

      {template.ozWizardUrl && (
        <a
          href={template.ozWizardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-[var(--accent)] hover:underline"
        >
          <ExternalLink size={11} strokeWidth={1.75} />
          <span>View OZ wizard config</span>
        </a>
      )}

      <div>
        <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
          Files ({template.files.length})
        </h4>
        <div className="space-y-0.5">
          {template.files.map((f) => (
            <div
              key={f.path}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-mono text-[var(--text-secondary)]"
            >
              <FileCode2 size={10} strokeWidth={1.75} className="text-[var(--text-muted)]" />
              <span className="truncate">{f.path}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
          Tags
        </h4>
        <div className="flex flex-wrap gap-1">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
