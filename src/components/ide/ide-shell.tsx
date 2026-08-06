"use client";

import { useEffect, useState, useMemo } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { TopBar } from "./topbar/top-bar";
import { ActivityBar, type ActivityView } from "./topbar/activity-bar";
import { FileExplorer } from "./explorer/file-explorer";
import { EditorArea } from "./editor/editor-area";
import { TerminalPanel } from "./terminal/terminal-panel";
import { RightPanel } from "./panels/right-panel";
import { StatusBar } from "./panels/status-bar";
import { CommandPalette } from "./panels/command-palette";
import { SettingsDialog } from "./panels/settings-dialog";
import { NewProjectModal } from "./templates/new-project-modal";
import { ProfileModal } from "./profile/profile-modal";
import { ShareDialog } from "./collab/share-dialog";
import { SnapshotPanel } from "./panels/snapshot-panel";
import { useThemeStore } from "@/stores/theme-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useProfileStore } from "@/stores/profile-store";
import { useBuildStore } from "@/stores/build-store";
import { useFixWithAIStore } from "@/stores/fix-with-ai-store";
import { useSnapshotStore } from "@/stores/snapshot-store";
import type { Template } from "@/lib/templates/registry";
import { flattenFiles } from "@/lib/soroban/sample-project";
import { cn } from "@/lib/utils";

type RightPanelView = "agent" | "compile" | "test" | "deploy" | "git";

export function IdeShell() {
  const [activityView, setActivityView] = useState<ActivityView>("explorer");
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>("agent");
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<"files" | "editor" | "terminal" | "agent">("editor");
  const [network, setNetwork] = useState("testnet");

  const editorFontSize = useThemeStore((s) => s.editorFontSize);
  const createFile = useFileSystemStore((s) => s.createFile);
  const hydrate = useFileSystemStore((s) => s.hydrate);
  const fsHydrated = useFileSystemStore((s) => s.hydrated);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const syncFromWallet = useProfileStore((s) => s.syncFromWallet);
  const buildStatus = useBuildStore((s) => s.status);
  const startBuild = useBuildStore((s) => s.startBuild);
  const requestFix = useFixWithAIStore((s) => s.requestFix);

  // §8 — Hydrate file system from IndexedDB on mount (local-first)
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // §11 — Listen for wallet connect/disconnect events.
  // When a wallet connects, check the server session to see if the user
  // has a profile. If they do, they're logged in. If not, open the profile
  // modal to complete their profile.
  useEffect(() => {
    function handleConnect(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.address) {
        // Check server session — if profile exists, user is logged in
        syncFromWallet(detail.address).then(() => {
          const state = useProfileStore.getState();
          if (!state.profile) {
            // No profile — open the profile modal to complete setup
            setProfileOpen(true);
          }
        });
      }
    }
    function handleDisconnect() {
      clearProfile();
    }
    window.addEventListener("sc-connect", handleConnect as EventListener);
    window.addEventListener("sc-disconnect", handleDisconnect as EventListener);
    return () => {
      window.removeEventListener("sc-connect", handleConnect as EventListener);
      window.removeEventListener("sc-disconnect", handleDisconnect as EventListener);
    };
  }, [syncFromWallet, clearProfile]);

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      } else if (cmd && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (cmd && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        createFile(null, "untitled.rs");
      } else if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setTerminalCollapsed((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        useThemeStore.getState().toggleMode();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setActivityView("agent");
        setRightPanelView("agent");
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRightPanelView("compile");
        startBuild();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setActivityView("explorer");
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setActivityView("search");
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setActivityView("git");
        setRightPanelView("git");
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setNewProjectOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createFile]);

  // Map activity view → right panel view
  function handleActivityChange(view: ActivityView) {
    setActivityView(view);
    if (view === "deploy") setRightPanelView("deploy");
    else if (view === "git") setRightPanelView("git");
    else if (view === "agent") setRightPanelView("agent");
  }

  function handleActivityToRightPanel(view: ActivityView) {
    if (view === "deploy" || view === "git" || view === "agent") {
      setRightPanelView(view);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
      <TopBar
        projectName="hello-world"
        branch="main"
        network={network}
        collabUsers={[]}
        profile={profile}
        building={buildStatus === "building"}
        onShare={() => setShareOpen(true)}
        onConnectWallet={async () => {
          // Try to open the saganta-appkit-modal if already mounted
          const modal = document.querySelector<HTMLElement & { open: () => void }>("saganta-appkit-modal");
          if (modal?.open) {
            modal.open();
          } else {
            // Modal not mounted yet — dispatch event to lazy-load it
            // The WalletMount component will compile stellar-appkit and open the modal
            window.dispatchEvent(new CustomEvent("soroban-connect-click"));
          }
        }}
        onOpenWalletModal={async () => {
          const modal = document.querySelector<HTMLElement & { open: () => void }>("saganta-appkit-modal");
          if (modal?.open) {
            modal.open();
          } else {
            window.dispatchEvent(new CustomEvent("soroban-connect-click"));
          }
        }}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={() => {
          clearProfile();
        }}
        onNewProject={() => setNewProjectOpen(true)}
        onCommandPalette={() => setCommandPaletteOpen(true)}
        onBuild={() => {
          setRightPanelView("compile");
          startBuild();
        }}
        onDeploy={() => {
          setActivityView("deploy");
          setRightPanelView("deploy");
        }}
        onSwitchNetwork={setNetwork}
      />

      {/* Desktop layout */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <ActivityBar
          active={activityView}
          onChange={handleActivityChange}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left panel — explorer / search / git / etc */}
          <Panel defaultSize={18} minSize={12} maxSize={30} className="bg-[var(--surface-panel)]">
            <SidePanel view={activityView} onOpenSettings={() => setSettingsOpen(true)} />
          </Panel>
          <PanelResizeHandle className="w-px bg-[var(--border-subtle)] hover:bg-[var(--accent)] transition-colors" />

          {/* Center — editor + terminal */}
          <Panel defaultSize={58} minSize={30}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={70} minSize={20} className="bg-[var(--surface-app)]">
                <EditorArea fontSize={editorFontSize} />
              </Panel>
              <PanelResizeHandle className="h-px bg-[var(--border-subtle)] hover:bg-[var(--accent)] transition-colors" />
              <Panel defaultSize={30} minSize={10} maxSize={70}>
                <TerminalPanel
                  collapsed={terminalCollapsed}
                  onToggleCollapse={() => setTerminalCollapsed((v) => !v)}
                  onFixWithAI={(errorOutput, command) => {
                    requestFix(errorOutput, command);
                    setActivityView("agent");
                    setRightPanelView("agent");
                  }}
                />
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="w-px bg-[var(--border-subtle)] hover:bg-[var(--accent)] transition-colors" />

          {/* Right panel — agent / compile / test / deploy / git */}
          <Panel defaultSize={24} minSize={15} maxSize={40}>
            <RightPanel
              view={rightPanelView}
              onChangeView={setRightPanelView}
              onOpenSettings={() => setSettingsOpen(true)}
              network={network}
            />
          </Panel>
        </PanelGroup>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <MobilePanel active={mobileActivePanel} />
        <MobileBottomNav
          active={mobileActivePanel}
          onChange={setMobileActivePanel}
        />
      </div>

      <StatusBar
        network={network}
        branch="main"
        rustToolchain="1.81.0"
        stellarCliVersion="22.0.0"
        syncStatus="offline"
        errors={0}
        warnings={0}
        cursorPos={{ line: 1, col: 1 }}
        collabCount={0}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNewFile={() => createFile(null, "untitled.rs")}
        onNewFolder={() => {}}
        onSave={() => {}}
        onToggleTerminal={() => setTerminalCollapsed((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onBuild={() => {
          setRightPanelView("compile");
          startBuild();
        }}
        onDeploy={() => {
          setActivityView("deploy");
          setRightPanelView("deploy");
        }}
        onOpenAgent={() => {
          setActivityView("agent");
          setRightPanelView("agent");
        }}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onSelectTemplate={async (template: Template) => {
          // Scaffold the template files into IndexedDB + file system
          const fs = useFileSystemStore.getState();
          await fs.replaceTree(
            template.files.map((f) => ({
              path: f.path,
              content: f.content,
              language: f.language,
            }))
          );
          // Open the first file
          const firstFile = template.files[0];
          if (firstFile) {
            useEditorTabsStore.getState().openTab(firstFile.path, firstFile.path.split("/").pop() ?? firstFile.path);
          }
        }}
        onSelectBlank={async () => {
          const fs = useFileSystemStore.getState();
          await fs.replaceTree([
            {
              path: "src/lib.rs",
              content: "#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n\n#[contract]\npub struct Contract;\n\n#[contractimpl]\nimpl Contract {\n    pub fn hello(env: Env) -> soroban_sdk::String {\n        soroban_sdk::String::from_str(&env, \"Hello, Soroban!\")\n    }\n}\n",
              language: "rust",
            },
            {
              path: "Cargo.toml",
              content: "[package]\nname = \"my-contract\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\ncrate-type = [\"cdylib\"]\n\n[dependencies]\nsoroban-sdk = \"22.0.0\"\n",
              language: "toml",
            },
          ]);
        }}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        existingProfile={profile}
        onComplete={(p) => {
          setProfile({
            address: p.address,
            username: p.username,
            avatarUrl: p.avatarUrl,
            bio: p.bio,
            createdAt: Date.now(),
          });
        }}
      />
    </div>
  );
}

function SidePanel({
  view,
  onOpenSettings,
}: {
  view: ActivityView;
  onOpenSettings: () => void;
}) {
  if (view === "explorer") return <FileExplorer onOpenSettings={onOpenSettings} />;
  if (view === "search") return <SearchPanel />;
  if (view === "git") return <GitSidePanel />;
  if (view === "deploy") return <DeploySidePanel />;
  if (view === "agent") return <AgentSidePanel />;
  if (view === "collab") return <CollabSidePanel />;
  return <FileExplorer onOpenSettings={onOpenSettings} />;
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const tree = useFileSystemStore((s) => s.tree);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const openTab = useEditorTabsStore((s) => s.openTab);

  // Compute search results synchronously (debounced via query change)
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const allFiles = flattenFiles(tree);
    const searchResults: {
      filePath: string;
      matches: { line: number; text: string; preview: string }[];
    }[] = [];
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

    for (const file of allFiles) {
      const lines = file.content.split("\n");
      const matches: { line: number; text: string; preview: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const preview = lines[i].trim().substring(0, 80);
          matches.push({ line: i + 1, text: lines[i], preview });
        }
        regex.lastIndex = 0;
      }
      if (matches.length > 0) {
        searchResults.push({ filePath: file.path, matches });
      }
    }
    return searchResults;
  }, [query, caseSensitive, tree]);

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  function handleResultClick(filePath: string, line: number) {
    setActiveFile(filePath);
    openTab(filePath, filePath.split("/").pop() ?? filePath);
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Search</span>
      </div>
      <div className="px-3 pb-2 space-y-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search across files…"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="Replace…"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-2 text-[10px]">
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors",
              caseSensitive
                ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            )}
          >
            Aa
          </button>
          {query && (
            <span className="text-[var(--text-muted)]">
              {totalMatches} {totalMatches === 1 ? "result" : "results"} in {results.length} {results.length === 1 ? "file" : "files"}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && query && (
          <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
            No results found.
          </div>
        )}
        {results.map((result) => (
          <div key={result.filePath} className="border-b border-[var(--border-subtle)]">
            <div className="px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--surface-sunken)]">
              {result.filePath}
              <span className="ml-2 text-[var(--text-muted)]">
                {result.matches.length} {result.matches.length === 1 ? "match" : "matches"}
              </span>
            </div>
            {result.matches.slice(0, 20).map((match, i) => (
              <button
                key={i}
                onClick={() => handleResultClick(result.filePath, match.line)}
                className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-[var(--surface-hover)] transition-colors"
              >
                <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                  {match.line}
                </span>
                <span className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                  {match.preview}
                </span>
              </button>
            ))}
            {result.matches.length > 20 && (
              <div className="px-3 py-1 text-[10px] text-[var(--text-muted)]">
                +{result.matches.length - 20} more matches
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GitSidePanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Source Control</span>
      </div>
      <div className="px-3 pb-2 space-y-2">
        <textarea
          placeholder="Commit message"
          rows={2}
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none"
        />
        <button className="w-full rounded bg-[var(--accent)] py-1.5 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors">
          Commit & Push
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Changes (2)</div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)] cursor-pointer">
            <span className="font-mono text-[var(--status-warning)] text-[10px]">M</span>
            <span className="text-[var(--text-secondary)]">src/lib.rs</span>
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)] cursor-pointer">
            <span className="font-mono text-[var(--status-info)] text-[10px]">U</span>
            <span className="text-[var(--text-secondary)]">src/test.rs</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeploySidePanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="p-3 space-y-2 border-b border-[var(--border-subtle)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Compile & Deploy</h3>
        <button
          onClick={() => {
            useBuildStore.getState().startBuild();
          }}
          className="w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          soroban contract build
        </button>
        <button
          onClick={() => {
            // §13.4 — Auto-snapshot before deploy
            const tree = useFileSystemStore.getState().tree;
            const files = flattenFiles(tree).map((f) => ({ path: f.path, content: f.content, language: f.language }));
            useSnapshotStore.getState().createSnapshot("Auto-snapshot before deploy", "", files);
          }}
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
        >
          Deploy to Testnet
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <SnapshotPanel />
      </div>
    </div>
  );
}

function AgentSidePanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)] p-3 gap-3 overflow-y-auto">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">AI Agent</h3>
      <p className="text-xs text-[var(--text-muted)]">
        BYOK agent for Soroban contract work. Configure a provider in Settings.
      </p>
      <button className="w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors">
        Open Agent Chat
      </button>
    </div>
  );
}

function CollabSidePanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)] p-3 gap-3 overflow-y-auto">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Collaboration</h3>
      <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5">
        <div className="text-xs text-[var(--text-secondary)] mb-1">Active session</div>
        <div className="text-[11px] text-[var(--text-muted)]">No one else is here. Share the project to invite collaborators.</div>
      </div>
      <button className="w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors">
        Generate share link
      </button>
    </div>
  );
}

function MobilePanel({ active }: { active: "files" | "editor" | "terminal" | "agent" }) {
  if (active === "files") return <FileExplorer />;
  if (active === "editor") {
    return (
      <div className="flex-1 overflow-hidden">
        <EditorArea />
      </div>
    );
  }
  if (active === "terminal") {
    return (
      <div className="flex-1 overflow-hidden">
        <TerminalPanel
          collapsed={false}
          onToggleCollapse={() => {}}
          onFixWithAI={(errorOutput, command) => {
            useFixWithAIStore.getState().requestFix(errorOutput, command);
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-hidden">
      <RightPanel view="agent" onChangeView={() => {}} />
    </div>
  );
}

function MobileBottomNav({
  active,
  onChange,
}: {
  active: "files" | "editor" | "terminal" | "agent";
  onChange: (v: "files" | "editor" | "terminal" | "agent") => void;
}) {
  const items: { id: typeof active; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "editor", label: "Editor" },
    { id: "terminal", label: "Terminal" },
    { id: "agent", label: "Agent" },
  ];
  return (
    <nav
      className="flex items-stretch border-t border-[var(--border-subtle)] bg-[var(--surface-panel)]"
      role="navigation"
      aria-label="Mobile navigation"
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "flex-1 py-2.5 text-[11px] font-medium transition-colors",
            active === item.id
              ? "text-[var(--accent)] border-t-2 border-[var(--accent)]"
              : "text-[var(--text-muted)]"
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
