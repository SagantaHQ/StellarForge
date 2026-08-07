"use client";

import { useEffect, useState, useMemo } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { TopBar } from "./topbar/top-bar";
import { FileExplorer } from "./explorer/file-explorer";
import { EditorArea } from "./editor/editor-area";
import { BuildOutputPanel } from "./panels/build-output-panel";
import { RightPanel } from "./panels/right-panel";
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
import { useThemeStore } from "@/stores/theme-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useProfileStore } from "@/stores/profile-store";
import { useBuildStore } from "@/stores/build-store";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import type { Template } from "@/lib/templates/registry";
import { cn } from "@/lib/utils";

type RightPanelView = "agent" | "compile" | "test" | "deploy" | "git";

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
        setRightPanelView("agent");
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRightPanelView("compile");
        startBuild();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setRightPanelView("git");
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setNewProjectOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createFile]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-app)] text-[var(--text-primary)]">
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

      {/* Desktop layout — left panel + center + right panel are always visible.
          The center area switches between the editor (when a project is active)
          and the welcome page (when not). The left panel is always the File
          Explorer (no ActivityBar tabs — the right panel handles view switching). */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left panel — file explorer (always visible) */}
          <Panel defaultSize={18} minSize={12} maxSize={30} className="bg-[var(--surface-panel)]">
            <FileExplorer onOpenSettings={() => setSettingsOpen(true)} />
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
          const files = [
            {
              path: "src/lib.rs",
              content: "#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n\n#[contract]\npub struct Contract;\n\n#[contractimpl]\nimpl Contract {\n    pub fn hello(env: Env) -> soroban_sdk::String {\n        soroban_sdk::String::from_str(&env, \"Hello, Soroban!\")\n    }\n}\n",
              language: "rust",
            },
            {
              path: "Cargo.toml",
              content: `[package]\nname = "${projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nsoroban-sdk = "22.0.0"\n`,
              language: "toml",
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
