"use client";

import { useEffect, useState } from "react";
import {
  Command as CommandPrimitive,
  Search,
  Sun,
  Moon,
  FilePlus,
  Terminal as TerminalIcon,
  Settings as SettingsIcon,
  GitBranch,
  Rocket,
  Bot,
  FolderPlus,
  Save,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";
import { BUILT_IN_THEMES } from "@/lib/themes/registry";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  shortcut?: string;
  action: () => void;
  category: "file" | "view" | "theme" | "git" | "agent";
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onSave: () => void;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onDeploy: () => void;
  onOpenAgent: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onNewFile,
  onNewFolder,
  onSave,
  onToggleTerminal,
  onOpenSettings,
  onDeploy,
  onOpenAgent,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const setTheme = useThemeStore((s) => s.setTheme);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  const baseCommands: Command[] = [
    { id: "new-file", label: "New File", icon: FilePlus, shortcut: "⌘N", category: "file", action: () => { onNewFile(); onClose(); } },
    { id: "new-folder", label: "New Folder", icon: FolderPlus, category: "file", action: () => { onNewFolder(); onClose(); } },
    { id: "save", label: "Save File", icon: Save, shortcut: "⌘S", category: "file", action: () => { onSave(); onClose(); } },
    { id: "toggle-terminal", label: "Toggle Terminal", icon: TerminalIcon, shortcut: "⌃`", category: "view", action: () => { onToggleTerminal(); onClose(); } },
    { id: "open-settings", label: "Open Settings", icon: SettingsIcon, shortcut: "⌘,", category: "view", action: () => { onOpenSettings(); onClose(); } },
    { id: "toggle-mode", label: "Toggle Dark/Light", icon: Sun, shortcut: "⌃⇧L", category: "theme", action: () => { toggleMode(); onClose(); } },
    { id: "deploy", label: "Deploy Contract", icon: Rocket, shortcut: "⌃⇧D", category: "git", action: () => { onDeploy(); onClose(); } },
    { id: "open-agent", label: "Open AI Agent", icon: Bot, shortcut: "⌃⌘I", category: "agent", action: () => { onOpenAgent(); onClose(); } },
  ];

  const themeCommands: Command[] = BUILT_IN_THEMES.map((t) => ({
    id: `theme-${t.id}`,
    label: `Theme: ${t.name}`,
    hint: t.description,
    icon: t.mode === "light" ? Sun : t.mode === "high-contrast" ? Sun : Moon,
    category: "theme" as const,
    action: () => {
      setTheme(t.id);
      onClose();
    },
  }));

  const allCommands = [...baseCommands, ...themeCommands];
  const filtered = query
    ? allCommands.filter((c) => {
        const q = query.toLowerCase();
        return (
          c.label.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.hint?.toLowerCase().includes(q)
        );
      })
    : allCommands;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selectedIdx]?.action();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Group by category
  const grouped = filtered.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  const categoryLabels: Record<string, string> = {
    file: "File",
    view: "View",
    theme: "Theme",
    git: "Source Control",
    agent: "AI Agent",
  };

  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
          <Search size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
              No matching commands
            </div>
          )}
          {Object.entries(grouped).map(([cat, cmds]) => (
            <div key={cat}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {categoryLabels[cat] ?? cat}
              </div>
              {cmds.map((cmd) => {
                const idx = runningIdx++;
                const isSelected = idx === selectedIdx;
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => cmd.action()}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                      isSelected ? "bg-[var(--accent-subtle)]" : ""
                    )}
                  >
                    <Icon
                      size={14}
                      strokeWidth={1.75}
                      className={isSelected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}
                    />
                    <span className="flex-1 text-[13px] text-[var(--text-primary)]">
                      {cmd.label}
                    </span>
                    {cmd.hint && (
                      <span className="hidden sm:inline text-[11px] text-[var(--text-muted)] truncate max-w-[200px]">
                        {cmd.hint}
                      </span>
                    )}
                    {cmd.shortcut && (
                      <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
