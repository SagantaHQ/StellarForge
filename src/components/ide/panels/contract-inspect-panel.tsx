"use client";

import { useMemo, useState } from "react";
import {
  FunctionSquare,
  Braces,
  ListTree,
  Type,
  FileText,
  ChevronRight,
  ChevronDown,
  Hash,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useBuildStore } from "@/stores/build-store";
import { flattenFiles } from "@/lib/soroban/sample-project";
import {
  parseFullContractSpec,
  formatType,
  type ContractSpec,
  type ContractFunction,
  type ContractStruct,
  type ContractEnum,
} from "@/lib/soroban/full-spec-parser";

type InspectTab = "functions" | "types" | "docs";

/**
 * ContractInspectPanel — shows the parsed contract specification.
 *
 * Appears after a successful build. Three sub-tabs:
 *   - Functions: name, args, return type, doc comments, visibility
 *   - Types: structs, enums, type aliases defined in the contract
 *   - Docs: all documentation comments extracted from the source
 */
export function ContractInspectPanel() {
  const [tab, setTab] = useState<InspectTab>("functions");
  const tree = useFileSystemStore((s) => s.tree);
  const buildStatus = useBuildStore((s) => s.status);

  const spec = useMemo(() => {
    if (buildStatus !== "success") return null;
    const rustFile = flattenFiles(tree).find(
      (f) => f.path === "src/lib.rs" || f.path.endsWith("lib.rs")
    );
    if (!rustFile) return null;
    return parseFullContractSpec(rustFile.content);
  }, [buildStatus, tree]);

  if (buildStatus !== "success") {
    return (
      <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <FunctionSquare size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Build the contract first to inspect its specification.
          </p>
        </div>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <FileText size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            No Rust source file found to parse.
          </p>
        </div>
      </div>
    );
  }

  const totalTypes = spec.structs.length + spec.enums.length + spec.typeAliases.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
        <SubTab
          active={tab === "functions"}
          onClick={() => setTab("functions")}
          icon={FunctionSquare}
          label={`Functions (${spec.functions.length})`}
        />
        <SubTab
          active={tab === "types"}
          onClick={() => setTab("types")}
          icon={Braces}
          label={`Types (${totalTypes})`}
        />
        <SubTab
          active={tab === "docs"}
          onClick={() => setTab("docs")}
          icon={FileText}
          label="Docs"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "functions" && <FunctionsTab spec={spec} />}
        {tab === "types" && <TypesTab spec={spec} />}
        {tab === "docs" && <DocsTab spec={spec} />}
      </div>
    </div>
  );
}

// ============================================================
// Sub-tab button
// ============================================================

function SubTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors",
        active
          ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
      )}
    >
      <Icon size={11} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ============================================================
// Functions tab
// ============================================================

function FunctionsTab({ spec }: { spec: ContractSpec }) {
  if (spec.functions.length === 0) {
    return <EmptyState message="No public functions found." />;
  }

  return (
    <div className="space-y-2">
      {spec.functions.map((fn) => (
        <FunctionCard key={fn.name} fn={fn} />
      ))}
    </div>
  );
}

function FunctionCard({ fn }: { fn: ContractFunction }) {
  const [expanded, setExpanded] = useState(false);
  const visibleArgs = fn.args.filter((a) => a.name !== "env" && a.name !== "_env");

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        )}
        <FunctionSquare size={11} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
        <span className="text-[12px] font-mono font-medium text-[var(--text-primary)]">
          {fn.name}
        </span>
        {fn.isConstructor && (
          <span className="rounded bg-[var(--accent-subtle)] px-1 text-[9px] text-[var(--accent)]">
            constructor
          </span>
        )}
        {fn.visibility === "private" && (
          <span className="rounded bg-[var(--surface-raised)] px-1 text-[9px] text-[var(--text-muted)]">
            private
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {visibleArgs.length} {visibleArgs.length === 1 ? "arg" : "args"} → {formatType(fn.returnType)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-2.5 space-y-2">
          {/* Doc comment */}
          {fn.doc && (
            <div className="rounded bg-[var(--surface-app)] p-2 text-[11px] text-[var(--text-muted)] italic leading-relaxed">
              {fn.doc}
            </div>
          )}

          {/* Arguments */}
          {visibleArgs.length > 0 ? (
            <div>
              <h4 className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                Arguments
              </h4>
              <div className="space-y-0.5">
                {visibleArgs.map((arg) => (
                  <div key={arg.name} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-[var(--text-primary)]">{arg.name}</span>
                    <span className="text-[var(--text-muted)]">:</span>
                    <span className="font-mono text-[var(--accent)]">{formatType(arg.type)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-muted)] italic">No arguments</p>
          )}

          {/* Return type */}
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="text-[var(--text-muted)]">Returns:</span>
            <span className="font-mono text-[var(--status-success)]">{formatType(fn.returnType)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Types tab
// ============================================================

function TypesTab({ spec }: { spec: ContractSpec }) {
  const hasTypes = spec.structs.length > 0 || spec.enums.length > 0 || spec.typeAliases.length > 0;

  if (!hasTypes) {
    return <EmptyState message="No user-defined types found." />;
  }

  return (
    <div className="space-y-3">
      {/* Structs */}
      {spec.structs.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            <Braces size={11} strokeWidth={1.75} />
            Structs ({spec.structs.length})
          </h4>
          <div className="space-y-1.5">
            {spec.structs.map((s) => (
              <StructCard key={s.name} struct={s} />
            ))}
          </div>
        </div>
      )}

      {/* Enums */}
      {spec.enums.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            <ListTree size={11} strokeWidth={1.75} />
            Enums ({spec.enums.length})
          </h4>
          <div className="space-y-1.5">
            {spec.enums.map((e) => (
              <EnumCard key={e.name} enum_={e} />
            ))}
          </div>
        </div>
      )}

      {/* Type aliases */}
      {spec.typeAliases.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            <Type size={11} strokeWidth={1.75} />
            Type Aliases ({spec.typeAliases.length})
          </h4>
          <div className="space-y-0.5">
            {spec.typeAliases.map((ta) => (
              <div
                key={ta.name}
                className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1"
              >
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="font-mono text-[var(--text-primary)]">{ta.name}</span>
                  <span className="text-[var(--text-muted)]">=</span>
                  <span className="font-mono text-[var(--accent)]">{formatType(ta.alias)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StructCard({ struct }: { struct: ContractStruct }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        )}
        <Braces size={11} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
        <span className="text-[12px] font-mono font-medium text-[var(--text-primary)]">
          {struct.name}
        </span>
        {struct.isEvent && (
          <span className="rounded bg-[var(--status-info)]/20 px-1 text-[9px] text-[var(--status-info)]">
            event
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {struct.fields.length} {struct.fields.length === 1 ? "field" : "fields"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-2.5 space-y-2">
          {struct.doc && (
            <div className="rounded bg-[var(--surface-app)] p-2 text-[11px] text-[var(--text-muted)] italic">
              {struct.doc}
            </div>
          )}
          {struct.fields.length > 0 ? (
            <div className="space-y-0.5">
              {struct.fields.map((field) => (
                <div key={field.name} className="flex items-baseline gap-2 text-[11px]">
                  <Hash size={9} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span className="font-mono text-[var(--text-primary)]">{field.name}</span>
                  <span className="text-[var(--text-muted)]">:</span>
                  <span className="font-mono text-[var(--accent)]">{formatType(field.type)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-muted)] italic">No fields (unit struct)</p>
          )}
        </div>
      )}
    </div>
  );
}

function EnumCard({ enum_ }: { enum_: ContractEnum }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={11} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
        )}
        <ListTree size={11} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
        <span className="text-[12px] font-mono font-medium text-[var(--text-primary)]">
          {enum_.name}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {enum_.variants.length} {enum_.variants.length === 1 ? "variant" : "variants"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-2.5 space-y-2">
          {enum_.doc && (
            <div className="rounded bg-[var(--surface-app)] p-2 text-[11px] text-[var(--text-muted)] italic">
              {enum_.doc}
            </div>
          )}
          <div className="space-y-0.5">
            {enum_.variants.map((variant) => (
              <div key={variant.name} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-[var(--text-primary)]">{variant.name}</span>
                {variant.data && (
                  <>
                    <span className="text-[var(--text-muted)]">({formatType(variant.data)})</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Docs tab
// ============================================================

function DocsTab({ spec }: { spec: ContractSpec }) {
  const hasDocs =
    spec.contractDoc ||
    spec.functions.some((f) => f.doc) ||
    spec.structs.some((s) => s.doc) ||
    spec.enums.some((e) => e.doc);

  if (!hasDocs) {
    return <EmptyState message="No documentation comments found in this contract." />;
  }

  return (
    <div className="space-y-3">
      {/* Contract-level docs */}
      {spec.contractDoc && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            Contract
          </h4>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5 text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {spec.contractDoc.trim()}
          </div>
        </div>
      )}

      {/* Function docs */}
      {spec.functions.filter((f) => f.doc).length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            Functions
          </h4>
          <div className="space-y-1.5">
            {spec.functions
              .filter((f) => f.doc)
              .map((fn) => (
                <div
                  key={fn.name}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <FunctionSquare size={10} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
                    <span className="text-[11px] font-mono font-medium text-[var(--text-primary)]">
                      {fn.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap pl-4">
                    {fn.doc}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Type docs */}
      {[...spec.structs, ...spec.enums]
        .filter((t) => t.doc)
        .map((type) => (
          <div
            key={type.name}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Braces size={10} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
              <span className="text-[11px] font-mono font-medium text-[var(--text-primary)]">
                {type.name}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap pl-4">
              {type.doc}
            </p>
          </div>
        ))}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <FileText size={20} strokeWidth={1.5} className="mx-auto mb-2 text-[var(--text-muted)]" />
      <p className="text-[11px] text-[var(--text-muted)]">{message}</p>
    </div>
  );
}
