"use client";

import { useEffect, useState } from "react";
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
import { useThemeStore } from "@/stores/theme-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProfileStore } from "@/stores/profile-store";
import { useBuildStore } from "@/stores/build-store";
import type { Template } from "@/lib/templates/registry";
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
  const [mobileActivePanel, setMobileActivePanel] = useState<"files" | "editor" | "terminal" | "agent">("editor");
  const [network, setNetwork] = useState("testnet");

  const editorFontSize = useThemeStore((s) => s.editorFontSize);
  const createFile = useFileSystemStore((s) => s.createFile);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const buildStatus = useBuildStore((s) => s.status);
  const startBuild = useBuildStore((s) => s.startBuild);

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
        onShare={() => setSettingsOpen(true)}
        onConnectWallet={() => setProfileOpen(true)}
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

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onSelectTemplate={(template: Template) => {
          // Scaffold the template files into the file system
          const fs = useFileSystemStore.getState();
          // Reset to template's file tree
          // (For now, just create the files one by one)
          for (const file of template.files) {
            const pathParts = file.path.split("/");
            const name = pathParts[pathParts.length - 1];
            const parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : null;
            fs.createFile(parentPath, name);
            // Set content after creation
            setTimeout(() => {
              fs.updateFileContent(file.path, file.content);
            }, 50);
          }
        }}
        onSelectBlank={() => {
          const fs = useFileSystemStore.getState();
          fs.createFile(null, "lib.rs");
        }}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
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
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Search</span>
      </div>
      <div className="px-3 pb-2">
        <input
          placeholder="Search across files…"
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <input
          placeholder="Replace…"
          className="mt-1.5 w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-xs text-[var(--text-muted)]">
        No results yet. Type a query above.
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
    <div className="flex h-full flex-col bg-[var(--surface-panel)] p-3 gap-3 overflow-y-auto">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Compile & Deploy</h3>
      <button className="w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors">
        soroban contract build
      </button>
      <button className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors">
        Deploy to Testnet
      </button>
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
        <TerminalPanel collapsed={false} onToggleCollapse={() => {}} />
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
