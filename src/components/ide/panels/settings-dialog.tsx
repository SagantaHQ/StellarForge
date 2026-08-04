"use client";

import { useState } from "react";
import {
  X,
  Check,
  Sun,
  Moon,
  Contrast,
  Type,
  Keyboard,
  Bell,
  Cloud,
  Plus,
  Trash2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useThemeStore } from "@/stores/theme-store";
import { BUILT_IN_THEMES } from "@/lib/themes/registry";
import type { ThemeDefinition } from "@/lib/themes/types";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Section = "appearance" | "editor" | "keybindings" | "notifications" | "sync" | "ai";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("appearance");

  if (!open) return null;

  const sections: { id: Section; label: string; icon: typeof Sun }[] = [
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "editor", label: "Editor", icon: Type },
    { id: "ai", label: "AI Provider", icon: Plus },
    { id: "keybindings", label: "Keybindings", icon: Keyboard },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "sync", label: "Sync & Offline", icon: Cloud },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close settings"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <nav className="w-48 shrink-0 border-r border-[var(--border-subtle)] p-2 space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors",
                    isActive
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <Icon size={14} strokeWidth={1.75} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {section === "appearance" && <AppearanceSettings />}
            {section === "editor" && <EditorSettings />}
            {section === "ai" && <AISettings />}
            {section === "keybindings" && <KeybindingsSettings />}
            {section === "notifications" && <NotificationsSettings />}
            {section === "sync" && <SyncSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const customThemes = useThemeStore((s) => s.customThemes);
  const removeCustomTheme = useThemeStore((s) => s.removeCustomTheme);
  const registerCustomTheme = useThemeStore((s) => s.registerCustomTheme);
  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Theme</h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Pick a theme. Built-ins obey the design rules — no gradients, no neons. Install custom themes from a JSON file or URL.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {allThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={themeId === theme.id}
              onSelect={() => setTheme(theme.id)}
              onRemove={theme.builtIn ? undefined : () => removeCustomTheme(theme.id)}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              // Demo: install a sample custom theme by cloning midnight
              const sample: ThemeDefinition = {
                ...BUILT_IN_THEMES[0],
                id: "custom-" + Date.now(),
                name: "My Custom Theme",
                builtIn: false,
                description: "User-installed theme",
              };
              registerCustomTheme(sample);
            }}
          >
            <Plus size={13} strokeWidth={1.75} />
            Install from JSON
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Download size={13} strokeWidth={1.75} />
            Export current
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  active,
  onSelect,
  onRemove,
}: {
  theme: ThemeDefinition;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const t = theme.tokens;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative overflow-hidden rounded-md border text-left transition-all",
        active
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
          : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      )}
    >
      {/* Mini preview — shows the palette */}
      <div className="flex h-16">
        <div className="flex flex-1 flex-col">
          <div style={{ background: t.surfaceApp }} className="flex-1" />
          <div style={{ background: t.surfacePanel }} className="flex-1" />
          <div style={{ background: t.surfaceRaised }} className="flex-1" />
        </div>
        <div className="w-12 flex flex-col">
          <div style={{ background: t.accent }} className="flex-1" />
          <div style={{ background: t.statusSuccess }} className="flex-1" />
          <div style={{ background: t.statusWarning }} className="flex-1" />
          <div style={{ background: t.statusError }} className="flex-1" />
        </div>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ background: t.surfacePanel }}>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{theme.name}</div>
          <div className="text-[10px] text-[var(--text-muted)] capitalize">{theme.mode}</div>
        </div>
        {active && (
          <Check size={14} className="text-[var(--accent)] shrink-0" strokeWidth={2} />
        )}
        {!theme.builtIn && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-colors"
            aria-label="Remove theme"
          >
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </button>
  );
}

function EditorSettings() {
  const editorFontSize = useThemeStore((s) => s.editorFontSize);
  const setEditorFontSize = useThemeStore((s) => s.setEditorFontSize);
  const [autosave, setAutosave] = useState(true);
  const [formatOnSave, setFormatOnSave] = useState(true);
  const [minimap, setMinimap] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Editor</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
              Font size: <span className="font-mono text-[var(--text-primary)]">{editorFontSize}px</span>
            </label>
            <Slider
              value={[editorFontSize]}
              onValueChange={(v) => setEditorFontSize(v[0])}
              min={10}
              max={22}
              step={1}
              className="w-full"
            />
          </div>

          <SettingRow label="Auto-save" desc="Save files automatically when changed">
            <Switch checked={autosave} onCheckedChange={setAutosave} />
          </SettingRow>
          <SettingRow label="Format on save" desc="Run rustfmt / prettier when saving">
            <Switch checked={formatOnSave} onCheckedChange={setFormatOnSave} />
          </SettingRow>
          <SettingRow label="Show minimap" desc="Mini code overview in the editor corner">
            <Switch checked={minimap} onCheckedChange={setMinimap} />
          </SettingRow>
          <SettingRow label="Word wrap" desc="Wrap long lines instead of horizontal scroll">
            <Switch checked={wordWrap} onCheckedChange={setWordWrap} />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

function AISettings() {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">AI Provider (BYOK)</h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Bring your own API key. Keys are stored only in your browser&apos;s IndexedDB and never sent to our servers (except when a provider blocks browser calls via CORS — then a thin proxy routes the request, never storing the key).
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            "OpenAI", "Claude (Anthropic)", "Gemini", "DeepSeek", "Kimi (Moonshot)",
            "OpenRouter", "Amazon Bedrock", "Cloudflare Workers AI",
            "Z-AI (GLM)", "Ollama (local)", "Custom OpenAI-compatible",
          ].map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-xs"
            >
              <span className="text-[var(--text-secondary)]">{p}</span>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-[var(--accent)] hover:bg-[var(--surface-hover)] px-2">
                Connect
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Approval Flow
        </h4>
        <SettingRow label="Always allow agent edits" desc="Skip the diff-approval step (use with caution)">
          <Switch checked={false} onCheckedChange={() => {}} />
        </SettingRow>
      </div>
    </div>
  );
}

function KeybindingsSettings() {
  const shortcuts = [
    { keys: "⌘K", action: "Open command palette" },
    { keys: "⌘S", action: "Save file" },
    { keys: "⌘N", action: "New file" },
    { keys: "⌃`", action: "Toggle terminal" },
    { keys: "⌘,", action: "Open settings" },
    { keys: "⌃⇧E", action: "Explorer view" },
    { keys: "⌃⇧F", action: "Search view" },
    { keys: "⌃⇧G", action: "Source control view" },
    { keys: "⌃⇧B", action: "Compile & deploy view" },
    { keys: "⌃⌘I", action: "AI agent view" },
    { keys: "⌃⇧C", action: "Collaboration view" },
    { keys: "⌃⇧L", action: "Toggle dark/light mode" },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Keybindings</h3>
      <div className="rounded-md border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-[var(--text-secondary)]">{s.action}</span>
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-primary)]">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsSettings() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
      <SettingRow label="In-app toasts" desc="Show toast notifications for actions">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
      <SettingRow label="Web push (PWA)" desc="Receive push notifications when installed">
        <Switch checked={false} onCheckedChange={() => {}} />
      </SettingRow>
      <SettingRow label="@-mentions in comments" desc="Notify when mentioned in a comment">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
      <SettingRow label="Share invites" desc="Notify when invited to a project">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
    </div>
  );
}

function SyncSettings() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sync & Offline</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Local-first: files, open tabs, editor state, unsaved buffers, and comment drafts live in IndexedDB and sync opportunistically when you reconnect.
      </p>
      <SettingRow label="Local-first editing" desc="Continue editing while offline; merge on reconnect">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
      <SettingRow label="Background sync" desc="Push changes to Postgres when online">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
      <SettingRow label="Conflict resolution: CRDT merge" desc="Automatically merge divergent edits on reconnect">
        <Switch checked onCheckedChange={() => {}} />
      </SettingRow>
      <div className="rounded-md bg-[var(--surface-sunken)] p-3 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-2 mb-1">
          <Cloud size={12} strokeWidth={1.75} />
          <span>Local storage: 12 files · 48 KB</span>
        </div>
        <div>Last sync: never (offline mode)</div>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-[var(--text-primary)]">{label}</div>
        <div className="text-[11px] text-[var(--text-muted)]">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
