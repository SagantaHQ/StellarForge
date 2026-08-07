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
import { BuildOutputPanel } from "./panels/build-output-panel";
import { RightPanel } from "./panels/right-panel";
import { GitPanel } from "./panels/git-panel";
import { StatusBar } from "./panels/status-bar";
import { CommandPalette } from "./panels/command-palette";
import { SettingsDialog } from "./panels/settings-dialog";
import { NewProjectModal } from "./templates/new-project-modal";
import { ProfileModal } from "./profile/profile-modal";
import { ShareDialog } from "./collab/share-dialog";
import { SnapshotPanel } from "./panels/snapshot-panel";
import { DeleteProjectModal } from "./projects/delete-project-modal";
import { ImportProjectModal } from "./projects/import-project-modal";
import { WelcomePage } from "./welcome/welcome-page";
import { LoadingOverlay } from "./ui/loading-overlay";
import { useThemeStore } from "@/stores/theme-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useProfileStore } from "@/stores/profile-store";
import { useBuildStore } from "@/stores/build-store";
import { useSnapshotStore } from "@/stores/snapshot-store";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import type { Template } from "@/lib/templates/registry";
import { flattenFiles } from "@/lib/soroban/sample-project";
import { cn } from "@/lib/utils";

type RightPanelView = "agent" | "compile" | "test" | "deploy";

/**
 * Resolve the server-side user ID from a wallet address.
 * Returns null if not logged in or the session check fails — the project
 * will be created local-only in that case.
 */
async function resolveOwnerId(walletAddress: string | null | undefined): Promise<string | null> {
  if (!walletAddress) return null;
  try {
    const res = await fetch(`/api/auth/session?address=${encodeURIComponent(walletAddress)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.loggedIn && data?.user?.id) return data.user.id;
    }
  } catch {
    // Network issue — proceed with local-only project
  }
  return null;
}

export function IdeShell() {
  const [activityView, setActivityView] = useState<ActivityView>("explorer");
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>("agent");
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectMeta | null>(null);
  const [importProjectOpen, setImportProjectOpen] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<"files" | "editor" | "build" | "agent">("editor");
  const [network, setNetwork] = useState("testnet");

  const editorFontSize = useThemeStore((s) => s.editorFontSize);
  const createFile = useFileSystemStore((s) => s.createFile);
  const hydrate = useFileSystemStore((s) => s.hydrate);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const setWalletConnected = useProfileStore((s) => s.setWalletConnected);
  const syncFromWallet = useProfileStore((s) => s.syncFromWallet);
  const buildStatus = useBuildStore((s) => s.status);
  const startBuild = useBuildStore((s) => s.startBuild);

  // Projects store — hydrates from IDB and syncs with Postgres when logged in
  const projectsHydrate = useProjectsStore((s) => s.hydrate);
  const projectsSyncFromServer = useProjectsStore((s) => s.syncFromServer);
  const projectsCreate = useProjectsStore((s) => s.createProject);
  const projectsSwitch = useProjectsStore((s) => s.switchProject);
  const projectsClose = useProjectsStore((s) => s.closeActiveProject);
  const projectsDelete = useProjectsStore((s) => s.deleteProject);
  const projectsList = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projectsBusy = useProjectsStore((s) => s.busy);
  const projectsHydrated = useProjectsStore((s) => s.hydrated);
  const activeProject = activeProjectId
    ? projectsList.find((p) => p.id === activeProjectId) ?? null
    : null;

  // §8 — Hydrate file system from IndexedDB on mount (local-first)
  useEffect(() => {
    hydrate();
    // Hydrate the projects list from IDB
    projectsHydrate();
    // Expose profile store on window for cross-store access (avoids circular imports)
    (window as unknown as { __profileStore: unknown }).__profileStore = useProfileStore.getState();
  }, [hydrate, projectsHydrate]);

  // When the user logs in, pull their server-side projects and merge into the
  // local list. Also push any local-only projects to the server.
  useEffect(() => {
    if (profile?.address) {
      // Look up the user's server id via the session endpoint
      fetch(`/api/auth/session?address=${encodeURIComponent(profile.address)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.loggedIn && data?.user?.id) {
            projectsSyncFromServer(data.user.id);
          }
        })
        .catch(() => {});
    }
  }, [profile?.address, projectsSyncFromServer]);

  // §11 — Listen for wallet connect/disconnect events.
  // When a wallet connects, check the server session to see if the user
  // has a profile. If they do, they're logged in. If not, open the profile
  // modal to complete their profile.
  useEffect(() => {
    function handleConnect(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.address) {
        // Wallet connected — set flag and check server session
        setWalletConnected(true);
        syncFromWallet(detail.address).then(() => {
          const state = useProfileStore.getState();
          if (!state.profile) {
            // Wallet connected but no profile in DB — open profile modal
            setProfileOpen(true);
          }
        });
      }
    }
    function handleDisconnect() {
      // Wallet disconnected — clear everything
      setWalletConnected(false);
      clearProfile();
    }
    window.addEventListener("sc-connect", handleConnect as EventListener);
    window.addEventListener("sc-disconnect", handleDisconnect as EventListener);
    return () => {
      window.removeEventListener("sc-connect", handleConnect as EventListener);
      window.removeEventListener("sc-disconnect", handleDisconnect as EventListener);
    };
  }, [syncFromWallet, clearProfile, setWalletConnected]);

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
    else if (view === "agent") setRightPanelView("agent");
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
      {/* Full-screen loading overlay for project operations (create/switch/import/delete) */}
      <LoadingOverlay
        visible={projectsBusy}
        variant="fullscreen"
        message="Working…"
        submessage="Saving files and syncing project state"
      />
      {/* Initial hydration loading — shown once while the projects store loads from IDB */}
      <LoadingOverlay
        visible={!projectsHydrated}
        variant="fullscreen"
        message="Loading your workspace…"
        submessage="Restoring projects from local storage"
      />
      <TopBar
        projectName={activeProject?.name ?? "No project"}
        branch="main"
        network={network}
        collabUsers={[]}
        profile={profile}
        building={buildStatus === "building"}
        hasBuilt={buildStatus === "success"}
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
          setRightPanelView("deploy");
        }}
        onSwitchNetwork={setNetwork}
        onSwitchProject={(id) => {
          projectsSwitch(id).catch(() => {});
        }}
        onCloseProject={() => {
          projectsClose().catch(() => {});
        }}
        onDeleteProject={(id) => {
          const target = projectsList.find((p) => p.id === id) ?? null;
          if (target) setDeleteProjectTarget(target);
        }}
        onImportProject={() => setImportProjectOpen(true)}
      />

      {/* Desktop layout — ActivityBar + left panel + center + right panel
          are always visible. The center area switches between the editor
          (when a project is active) and the welcome page (when not). */}
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

          {/* Center — editor (when project open) or welcome page (when not) */}
          <Panel defaultSize={58} minSize={30}>
            {activeProject ? (
              <PanelGroup direction="vertical">
                <Panel defaultSize={70} minSize={20} className="bg-[var(--surface-app)]">
                  <EditorArea fontSize={editorFontSize} />
                </Panel>
                <PanelResizeHandle className="h-px bg-[var(--border-subtle)] hover:bg-[var(--accent)] transition-colors" />
                <Panel defaultSize={30} minSize={10} maxSize={70}>
                  <BuildOutputPanel
                    collapsed={terminalCollapsed}
                    onToggleCollapse={() => setTerminalCollapsed((v) => !v)}
                  />
                </Panel>
              </PanelGroup>
            ) : (
              <WelcomePage
                onNewProject={() => setNewProjectOpen(true)}
                onBrowseTemplates={() => setNewProjectOpen(true)}
                onImportProject={() => setImportProjectOpen(true)}
                onOpenProject={(id) => {
                  projectsSwitch(id).catch(() => {});
                }}
                onDeleteProject={(project) => setDeleteProjectTarget(project)}
              />
            )}
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
        {activeProject ? (
          <>
            <MobilePanel active={mobileActivePanel} />
            <MobileBottomNav
              active={mobileActivePanel}
              onChange={setMobileActivePanel}
            />
          </>
        ) : (
          <WelcomePage
            onNewProject={() => setNewProjectOpen(true)}
            onBrowseTemplates={() => setNewProjectOpen(true)}
            onImportProject={() => setImportProjectOpen(true)}
            onOpenProject={(id) => {
              projectsSwitch(id).catch(() => {});
            }}
            onDeleteProject={(project) => setDeleteProjectTarget(project)}
          />
        )}
      </div>

      <StatusBar
        network={network}
        branch="main"
        rustToolchain="1.81.0"
        stellarCliVersion="22.1.0"
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
          setRightPanelView("deploy");
        }}
        onOpenAgent={() => {
          setRightPanelView("agent");
        }}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onSelectTemplate={async (template: Template, projectName: string) => {
          // Scaffold the template files into a new project (local + server)
          const files = template.files.map((f) => ({
            path: f.path,
            content: f.content,
            language: f.language,
          }));
          const ownerId = await resolveOwnerId(profile?.address);
          await projectsCreate({
            name: projectName,
            description: template.description,
            files,
            ownerId,
          });
          // Open the first file
          const firstFile = template.files[0];
          if (firstFile) {
            useEditorTabsStore.getState().openTab(firstFile.path, firstFile.path.split("/").pop() ?? firstFile.path);
          }
        }}
        onSelectBlank={async (projectName: string) => {
          const slug = projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
          const files = [
            {
              path: "src/lib.rs",
              language: "rust",
              content: "#![no_std]\n\nuse soroban_sdk::{contract, contractimpl, Env, String};\n\n#[contract]\npub struct Contract;\n\n#[contractimpl]\nimpl Contract {\n    /// Initialize the contract.\n    pub fn __constructor(_env: Env) {\n        // Initialize storage here\n    }\n\n    /// Returns a greeting.\n    pub fn hello(env: Env) -> String {\n        String::from_str(&env, \"Hello, Soroban!\")\n    }\n}\n",
            },
            {
              path: "Cargo.toml",
              language: "toml",
              content: `[package]\nname = "${slug}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nsoroban-sdk = "22.1.0"\n\n[dev_dependencies]\nsoroban-sdk = { version = "22.1.0", features = ["testutils"] }\n\n[profile.release]\nopt-level = "z"\noverflow-checks = true\ndebug = 0\nstrip = "symbols"\ndebug-assertions = false\npanic = "abort"\ncodegen-units = 1\nlto = true\n`,
            },
            {
              path: ".gitignore",
              language: "plaintext",
              content: "# Rust\n/target\n**/*.rs.bk\n\n# Soroban\n*.wasm\n.soroban/\n\n# Editor\n.vscode/\n.idea/\n\n# Env\n.env\n.env.local\n",
            },
            {
              path: "README.md",
              language: "markdown",
              content: `# ${projectName}\n\nDescribe your contract here.\n\n## Build\n\n\`\`\`sh\nsoroban contract build\n\`\`\`\n\n## Test\n\n\`\`\`sh\ncargo test\n\`\`\`\n`,
            },
          ];
          const ownerId = await resolveOwnerId(profile?.address);
          await projectsCreate({
            name: projectName,
            files,
            ownerId,
          });
        }}
      />

      <ImportProjectModal
        open={importProjectOpen}
        onClose={() => setImportProjectOpen(false)}
        onImport={async (projectName, files) => {
          const ownerId = await resolveOwnerId(profile?.address);
          await projectsCreate({
            name: projectName,
            files,
            ownerId,
          });
        }}
      />

      <DeleteProjectModal
        open={deleteProjectTarget !== null}
        project={deleteProjectTarget}
        onClose={() => setDeleteProjectTarget(null)}
        onConfirm={async (projectId) => {
          const requesterId = await resolveOwnerId(profile?.address);
          await projectsDelete(projectId, requesterId);
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

  function handleResultClick(filePath: string, _line: number) {
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
  return <GitPanel />;
}

function DeploySidePanel() {
  const tree = useFileSystemStore((s) => s.tree);
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
          stellar contract build
        </button>
        <button
          onClick={() => {
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

function MobilePanel({ active }: { active: "files" | "editor" | "build" | "agent" }) {
  if (active === "files") return <FileExplorer />;
  if (active === "editor") {
    return (
      <div className="flex-1 overflow-hidden">
        <EditorArea />
      </div>
    );
  }
  if (active === "build") {
    return (
      <div className="flex-1 overflow-hidden">
        <BuildOutputPanel collapsed={false} onToggleCollapse={() => {}} />
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
  active: "files" | "editor" | "build" | "agent";
  onChange: (v: "files" | "editor" | "build" | "agent") => void;
}) {
  const items: { id: typeof active; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "editor", label: "Editor" },
    { id: "build", label: "Build" },
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
