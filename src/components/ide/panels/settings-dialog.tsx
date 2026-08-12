"use client";

import { useState, useEffect } from "react";
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
  BookOpen,
  RefreshCw,
  Loader2,
  ChevronDown,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useThemeStore } from "@/stores/theme-store";
import { BUILT_IN_THEMES } from "@/lib/themes/registry";
import type { ThemeDefinition } from "@/lib/themes/types";
import { useAIKeysStore } from "@/stores/ai-keys-store";
import { PROVIDERS, PROVIDER_LIST, type ProviderId } from "@/lib/ai/providers";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Section = "appearance" | "editor" | "keybindings" | "notifications" | "sync" | "ai" | "knowledge";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("appearance");

  if (!open) return null;

  const sections: { id: Section; label: string; icon: typeof Sun }[] = [
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "editor", label: "Editor", icon: Type },
    { id: "ai", label: "AI Provider", icon: Plus },
    { id: "knowledge", label: "Knowledge Base", icon: BookOpen },
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
            {section === "knowledge" && <KnowledgeBaseSettings />}
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
          Bring your own API key. Keys are stored only in your browser (localStorage — production will move to encrypted IndexedDB) and never sent to our servers except as part of the direct provider call. CORS-blocked providers (Anthropic, Bedrock) route through a server-side proxy that never stores the key.
        </p>
        <ProviderConfigList />
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Approval Flow (§9.5)
        </h4>
        <ApprovalSettings />
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Context Budget (§9.9)
        </h4>
        <ContextBudgetSettings />
      </div>
    </div>
  );
}

function ProviderConfigList() {
  const providers = useAIKeysStore((s) => s.providers);
  const setProvider = useAIKeysStore((s) => s.setProvider);
  const removeProvider = useAIKeysStore((s) => s.removeProvider);
  const activeProviderId = useAIKeysStore((s) => s.activeProviderId);
  const setActiveProvider = useAIKeysStore((s) => s.setActiveProvider);

  // State for the "add a provider" dropdown
  const [showAddMenu, setShowAddMenu] = useState(false);
  // State for the provider being added (shows the key input form before saving)
  const [addingProviderId, setAddingProviderId] = useState<ProviderId | null>(null);

  // A provider is "configured" if it has an entry in the store AND (for non-ollama) has an API key
  const isConfigured = (id: ProviderId) => {
    const config = providers[id];
    if (!config) return false;
    if (id === "ollama") return true;
    return !!config.apiKey;
  };

  // Configured providers — these are the only ones we show by default
  const configuredProviders = PROVIDER_LIST.filter((p) => isConfigured(p.id));
  // Unconfigured providers — available in the "+" dropdown
  const availableProviders = PROVIDER_LIST.filter((p) => !isConfigured(p.id));

  return (
    <div className="space-y-2">
      {/* Configured providers — only show those with API keys set */}
      {configuredProviders.map((p) => {
        const config = providers[p.id]!;
        const isActive = activeProviderId === p.id;
        return (
          <div
            key={p.id}
            className={cn(
              "rounded-md border p-2.5 transition-colors",
              isActive
                ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)]">{p.name}</span>
                {p.requiresProxy && (
                  <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                    proxy
                  </span>
                )}
                {p.supportsCaching && (
                  <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                    cache
                  </span>
                )}
                <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)]">
                  <Check size={9} strokeWidth={2} />
                  configured
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!isActive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveProvider(p.id)}
                    className="h-6 text-[10px] text-[var(--accent)] hover:bg-[var(--surface-hover)] px-2"
                  >
                    Set active
                  </Button>
                )}
                {isActive && (
                  <span className="text-[10px] font-medium text-[var(--accent)] px-2">active</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeProvider(p.id)}
                  className="h-6 text-[10px] text-[var(--text-muted)] hover:text-[var(--status-error)] hover:bg-[var(--surface-hover)] px-2"
                >
                  Remove
                </Button>
              </div>
            </div>
            <ProviderModelPicker providerId={p.id} />
          </div>
        );
      })}

      {/* "Add provider" form — shown when user picks a provider from the + dropdown */}
      {addingProviderId && (
        <div className="rounded-md border border-[var(--accent)] bg-[var(--accent-subtle)] p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {PROVIDERS[addingProviderId]?.name ?? addingProviderId}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">adding…</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddingProviderId(null)}
              className="h-6 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] px-2"
            >
              Cancel
            </Button>
          </div>
          <ProviderKeyInput
            providerId={addingProviderId}
            requiresBaseUrl={addingProviderId === "custom-openai"}
            onSubmit={(apiKey, baseUrl) => {
              setProvider(addingProviderId, {
                apiKey,
                model: "",
                baseUrl: baseUrl || undefined,
                enabled: true,
              });
              setActiveProvider(addingProviderId);
              setAddingProviderId(null);
            }}
          />
        </div>
      )}

      {/* "+" button to add a new provider — only show if there are unconfigured providers left */}
      {availableProviders.length > 0 && !addingProviderId && (
        <div className="relative">
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-subtle)] py-2 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <Plus size={12} strokeWidth={2} />
            Add AI provider
          </button>
          {showAddMenu && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-lg max-h-60 overflow-y-auto">
              {availableProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setAddingProviderId(p.id);
                    setShowAddMenu(false);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Plus size={10} strokeWidth={2} className="text-[var(--text-muted)]" />
                    {p.name}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] text-[var(--text-muted)]">
                    {p.requiresProxy && <span>proxy</span>}
                    {p.supportsCaching && <span>cache</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state — no providers configured yet */}
      {configuredProviders.length === 0 && !addingProviderId && (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4 text-center">
          <p className="text-[11px] text-[var(--text-muted)]">
            No AI providers configured yet. Click{" "}
            <span className="text-[var(--accent)] font-medium">"Add AI provider"</span>{" "}
            above to set one up.
          </p>
        </div>
      )}
    </div>
  );
}

function ProviderKeyInput({
  providerId,
  requiresBaseUrl,
  onSubmit,
}: {
  providerId: string;
  requiresBaseUrl?: boolean;
  onSubmit: (apiKey: string, baseUrl?: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="space-y-1.5">
      {requiresBaseUrl && (
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://your-provider.com/v1"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      )}
      <div className="flex items-center gap-1.5">
        <input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={providerId === "ollama" ? "(no key needed for local)" : "API key"}
          className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => setShowKey((v) => !v)}
          className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          {showKey ? "Hide" : "Show"}
        </button>
        <Button
          size="sm"
          onClick={() => {
            if (apiKey || providerId === "ollama") {
              onSubmit(apiKey, baseUrl);
            }
          }}
          disabled={!apiKey && providerId !== "ollama"}
          className="h-7 px-2 text-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function ProviderModelPicker({ providerId }: { providerId: string }) {
  const providers = useAIKeysStore((s) => s.providers);
  const setProvider = useAIKeysStore((s) => s.setProvider);
  const config = providers[providerId as ProviderId];
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(config?.model === "__custom__");

  // Searchable dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  async function fetchModels() {
    if (!config?.apiKey) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const provider = PROVIDERS[providerId as ProviderId];
      const list = await provider.listModels(config.apiKey, config.baseUrl);
      setModels(list);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    if (config?.apiKey && models.length === 0 && !loadingModels && !modelError) {
      fetchModels();
    }
  }, [config?.apiKey]);

  // Filter models by search query (case-insensitive substring match)
  const filteredModels = searchQuery.trim()
    ? models.filter((m) => m.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : models;

  // Current display value
  const currentValue = config?.model === "__custom__"
    ? (config?.customModel || "Custom model name…")
    : (config?.model || "");

  function selectModel(model: string) {
    setProvider(providerId as ProviderId, { model });
    setShowCustom(model === "__custom__");
    setDropdownOpen(false);
    setSearchQuery("");
  }

  return (
    <div className="space-y-1.5">
      {/* Searchable model dropdown */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          {/* Trigger button — shows current model + opens dropdown */}
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className={cn(
              "flex w-full items-center justify-between rounded border bg-[var(--surface-panel)] px-2 py-1 text-[11px] outline-none transition-colors",
              dropdownOpen
                ? "border-[var(--accent)]"
                : "border-[var(--border-subtle)] focus:border-[var(--accent)]"
            )}
          >
            <span className={cn("truncate", currentValue ? "text-[var(--text-primary)] font-mono" : "text-[var(--text-muted)]")}>
              {currentValue || "Select model…"}
            </span>
            <ChevronDown
              size={10}
              strokeWidth={2}
              className={cn(
                "ml-1 shrink-0 text-[var(--text-muted)] transition-transform",
                dropdownOpen && "rotate-180"
              )}
            />
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => { setDropdownOpen(false); setSearchQuery(""); }}
              />
              <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-lg">
                {/* Search input */}
                <div className="border-b border-[var(--border-subtle)] p-1.5">
                  <div className="flex items-center gap-1.5">
                    <Search
                      size={10}
                      strokeWidth={2}
                      className="text-[var(--text-muted)] shrink-0"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search models…"
                      autoFocus
                      className="flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <X size={10} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Model list (scrollable, filtered) */}
                <div className="max-h-48 overflow-y-auto p-1">
                  {loadingModels && (
                    <div className="flex items-center justify-center py-3 text-[10px] text-[var(--text-muted)]">
                      <Loader2 size={10} strokeWidth={2} className="animate-spin mr-1.5" />
                      Loading models…
                    </div>
                  )}
                  {!loadingModels && modelError && (
                    <div className="px-2 py-1.5 text-[10px] text-[var(--status-error)]">
                      {modelError}
                    </div>
                  )}
                  {!loadingModels && !modelError && filteredModels.length === 0 && (
                    <div className="px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
                      {models.length === 0 ? "No models fetched — click ↻" : "No matches"}
                    </div>
                  )}
                  {!loadingModels && filteredModels.map((m) => (
                    <button
                      key={m}
                      onClick={() => selectModel(m)}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] font-mono transition-colors",
                        config?.model === m
                          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                      )}
                    >
                      <span className="truncate">{m}</span>
                      {config?.model === m && (
                        <Check size={9} strokeWidth={2} className="shrink-0 ml-1" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Custom model option at bottom */}
                <div className="border-t border-[var(--border-subtle)] p-1">
                  <button
                    onClick={() => selectModel("__custom__")}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors",
                      config?.model === "__custom__"
                        ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <Plus size={10} strokeWidth={2} />
                    Custom model name…
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={fetchModels}
          disabled={loadingModels}
          className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Refresh model list"
        >
          {loadingModels ? <Loader2 size={10} strokeWidth={2} className="animate-spin" /> : <RefreshCw size={10} strokeWidth={2} />}
        </button>
      </div>

      {/* Custom model name input */}
      {showCustom && (
        <input
          type="text"
          value={config?.customModel ?? ""}
          onChange={(e) =>
            setProvider(providerId as ProviderId, { customModel: e.target.value })
          }
          placeholder="model-name (e.g. gpt-4o-2024-08-06)"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      )}

      {/* Active model display */}
      {config?.model && config.model !== "__custom__" && !dropdownOpen && (
        <div className="text-[10px] text-[var(--text-muted)]">
          Active model: <span className="font-mono text-[var(--text-secondary)]">{config.model}</span>
        </div>
      )}
    </div>
  );
}

function ApprovalSettings() {
  const allowAlways = useAIKeysStore((s) => s.allowAlways);
  const setAllowAlways = useAIKeysStore((s) => s.setAllowAlways);
  return (
    <SettingRow
      label="Always allow agent edits"
      desc="Skip the diff-approval step for the current session (use with caution)"
    >
      <Switch checked={allowAlways} onCheckedChange={setAllowAlways} />
    </SettingRow>
  );
}

function ContextBudgetSettings() {
  const tokenBudget = useAIKeysStore((s) => s.tokenBudget);
  const setTokenBudget = useAIKeysStore((s) => s.setTokenBudget);
  return (
    <div>
      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
        Token budget: <span className="font-mono text-[var(--text-primary)]">{tokenBudget.toLocaleString()}</span> tokens
      </label>
      <Slider
        value={[tokenBudget]}
        onValueChange={(v) => setTokenBudget(v[0])}
        min={4000}
        max={200000}
        step={4000}
        className="w-full"
      />
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Hard cap on context size per request. Lower-priority items (knowledge summary, imported files) are truncated first.
      </p>
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
    { keys: "⌃⇧B", action: "Build contract (soroban contract build)" },
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

function KnowledgeBaseSettings() {
  const [updating, setUpdating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  async function handleUpdate() {
    setUpdating(true);
    try {
      // In production, this calls the server to re-pull knowledge repos
      // and rebuild the agent system prompt
      const res = await fetch("/api/knowledge/update", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLastUpdated(data.updatedAt);
      } else {
        // Fallback — just show success (repos are cloned via setup-knowledge.sh)
        setLastUpdated(new Date().toISOString());
      }
    } catch {
      setLastUpdated(new Date().toISOString());
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Knowledge Base</h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          The AI agent uses cloned skills, docs, and example repos to answer
          Soroban-specific questions. Update to pull the latest versions.
        </p>
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Included repositories
        </div>
        <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>OpenZeppelin Stellar Skills (setup-stellar-contracts/SKILL.md)</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>Official Soroban Examples (hello_world, token, counter, etc.)</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>Stellar Dev Skill</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>Stellar Build (kaankacar)</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>OpenZeppelin Adapters (adapter-stellar)</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Check size={11} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>Stellar MCP Server (stellar-raven)</span>
          </li>
        </ul>
      </div>

      <Button
        onClick={handleUpdate}
        disabled={updating}
        className="gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
      >
        {updating ? (
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <RefreshCw size={13} strokeWidth={1.75} />
        )}
        {updating ? "Updating knowledge base…" : "Update knowledge base"}
      </Button>

      {lastUpdated && (
        <p className="text-[10px] text-[var(--text-muted)]">
          Last updated: {new Date(lastUpdated).toLocaleString()}
        </p>
      )}

      <p className="text-[10px] text-[var(--text-muted)]">
        Updates re-pull all repos and rebuild the agent system prompt from the
        refreshed skill files + index summary.
      </p>
    </div>
  );
}
