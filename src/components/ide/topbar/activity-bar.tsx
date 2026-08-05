"use client";

import {
  Files,
  Search,
  GitBranch,
  Rocket,
  Bot,
  Users,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ActivityView =
  | "explorer"
  | "search"
  | "git"
  | "deploy"
  | "agent"
  | "collab"
  | "settings";

interface ActivityItem {
  id: ActivityView;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const ITEMS: ActivityItem[] = [
  { id: "explorer", icon: Files, label: "Explorer", shortcut: "⇧⌘E" },
  { id: "search", icon: Search, label: "Search", shortcut: "⇧⌘F" },
  { id: "git", icon: GitBranch, label: "Source Control", shortcut: "⌃⇧G" },
  { id: "deploy", icon: Rocket, label: "Compile & Deploy", shortcut: "⌃⇧B" },
  { id: "agent", icon: Bot, label: "AI Agent", shortcut: "⌃⌘I" },
  { id: "collab", icon: Users, label: "Collaboration", shortcut: "⌃⇧C" },
];

interface ActivityBarProps {
  active: ActivityView;
  onChange: (v: ActivityView) => void;
  onOpenSettings: () => void;
}

export function ActivityBar({ active, onChange, onOpenSettings }: ActivityBarProps) {
  return (
    <div
      className="flex h-full w-12 flex-col items-center justify-between border-r border-[var(--border-subtle)] bg-[var(--surface-panel)] py-2"
      role="toolbar"
      aria-label="Activity Bar"
    >
      <nav className="flex flex-col items-center gap-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                "group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150",
                isActive
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              )}
              aria-label={item.label}
              aria-pressed={isActive}
              title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r bg-[var(--accent)]"
                  aria-hidden="true"
                />
              )}
              <Icon size={20} strokeWidth={1.75} />
            </button>
          );
        })}
      </nav>

      <button
        onClick={onOpenSettings}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        )}
        aria-label="Settings"
        title="Settings (⌘,)"
      >
        <Settings size={20} strokeWidth={1.75} />
      </button>
    </div>
  );
}
