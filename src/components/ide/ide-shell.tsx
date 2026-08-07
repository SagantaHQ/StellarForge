"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Search, Rocket } from "lucide-react";
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
import { PackagesPanel } from "./panels/packages-panel";
import { StatusBar } from "./panels/status-bar";
import { CommandPalette } from "./panels/command-palette";
import { SettingsDialog } from "./panels/settings-dialog";
import { NewProjectModal } from "./templates/new-project-modal";
import { ProfileModal } from "./profile/profile-modal";
import { ShareDialog } from "./collab/share-dialog";
import { DeleteProjectModal } from "./projects/delete-project-modal";
import { ImportProjectModal } from "./projects/import-project-modal";
import { WelcomePage } from "./welcome/welcome-page";
import { LoadingOverlay } from "./ui/loading-overlay";
import { useThemeStore } from "@/stores/theme-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useProfileStore } from "@/stores/profile-store";
import { useBuildStore } from "@/stores/build-store";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { useAutocompleteStore } from "@/stores/autocomplete-store";
import type { Template } from "@/lib/templates/registry";
import { flattenFiles } from "@/lib/soroban/sample-project";
import { cn } from "@/lib/utils";

type RightPanelView = "agent" | "compile" | "deploy" | "inspect";

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
  const buildSilent = useBuildStore((s) => s.silent);
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

  // Autocomplete store — builds artifacts after a successful build
  const buildAutocomplete = useAutocompleteStore((s) => s.build);
  const tree = useFileSystemStore((s) => s.tree);

  // §8 — Hydrate file system from IndexedDB on mount (local-first)
  useEffect(() => {
    hydrate();
    // Hydrate the projects list from IDB
    projectsHydrate();
    // Expose profile store on window for cross-store access (avoids circular imports)
    (window as unknown as { __profileStore: unknown }).__profileStore = useProfileStore.getState();
  }, [hydrate, projectsHydrate]);

  // Auto-build on project load: when a project becomes active (and we haven't
  // built for this project yet), trigger a stellar contract build so the user
  // sees compile results immediately. Only runs ONCE per project switch —
  // uses a ref to track the last-built project ID to prevent loops.
  const lastBuiltProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeProject && projectsHydrated && lastBuiltProjectRef.current !== activeProject.id) {
      lastBuiltProjectRef.current = activeProject.id;
      // Small delay to let the file system store settle after project switch
      const timer = setTimeout(() => {
        // Only build if the build status is idle (not already building)
        if (useBuildStore.getState().status === "idle") {
          startBuild({ silent: true }); // auto-build is silent — no loading spinner
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [activeProject?.id, projectsHydrated, startBuild]);

  // Build autocomplete artifacts after a successful build (or project load)
  // This refreshes the completion DB with the latest functions, types, and
  // dependency APIs. Also runs on project switch.
  useEffect(() => {
    if (activeProject && projectsHydrated && buildStatus === "success") {
      // Small delay to ensure file system is settled
      const timer = setTimeout(() => {
        buildAutocomplete(tree);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [buildStatus, activeProject?.id, projectsHydrated, buildAutocomplete, tree]);

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
  // When a wallet connects, we MUST do SIWS (Sign-In With Stellar):
  //   1. Wallet signs a message proving ownership
  //   2. Server verifies the signature → creates a session
  //   3. Check if the user has a profile → open profile modal if not
  useEffect(() => {
    function handleConnect(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.address) {
        // Wallet connected — set flag + store the address
        setWalletConnected(true, detail.address);

        // Step 1: Try SIWS login (sign message → verify → create session)
        // We need the appkit instance to sign the SIWS message
        async function doSiwsLogin() {
          try {
            // Get the appkit instance from the modal
            const modal = document.querySelector<HTMLElement & { client: unknown }>("saganta-appkit-modal");
            const appkit = modal?.client as {
              signIn: (opts: { statement: string; nonce: string }) => Promise<{
                message: string;
                signedMessage: string;
                signerAddress: string;
                signedData?: string;
              }>;
            } | null;

            if (!appkit) {
              // Appkit not mounted yet — fall back to passive session check
              syncFromWallet(detail.address);
              return;
            }

            // Fetch nonce from server
            const nonceRes = await fetch("/api/auth/nonce");
            if (!nonceRes.ok) {
              syncFromWallet(detail.address);
              return;
            }
            const { nonce } = await nonceRes.json();

            // Sign the SIWS message
            const statement = `Sign in to Soroban.Build`;
            const siwsResult = await appkit.signIn({ statement, nonce });

            // Verify on server + create session
            const loginResult = await useProfileStore.getState().loginWithSiws({
              message: siwsResult.message,
              signedMessage: siwsResult.signedMessage,
              signerAddress: siwsResult.signerAddress,
              nonce,
              signedData: siwsResult.signedData,
            });

            // If login succeeded but user has no profile → open profile modal
            if (loginResult.loggedIn && loginResult.needsProfile) {
              setProfileOpen(true);
            }
          } catch (err) {
            // SIWS failed (user rejected, network error, etc.)
            // Fall back to passive session check — if the user already has
            // a session from a previous login, they can still use the IDE
            console.error("[SIWS] Login failed, falling back to passive check:", err);
            syncFromWallet(detail.address);
          }
        }

        doSiwsLogin();
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
        building={buildStatus === "building" && !buildSilent}
        hasBuilt={buildStatus === "success"}
        onShare={() => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          setShareOpen(true);
        }}
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
        onNewProject={() => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          setNewProjectOpen(true);
        }}
        onCommandPalette={() => setCommandPaletteOpen(true)}
        onBuild={() => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          setRightPanelView("compile");
          startBuild();
        }}
        onDeploy={() => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          setRightPanelView("deploy");
        }}
        onSwitchNetwork={setNetwork}
        onSwitchProject={(id) => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          projectsSwitch(id).catch(() => {});
        }}
        onCloseProject={() => {
          projectsClose().catch(() => {});
        }}
        onDeleteProject={(id) => {
          const target = projectsList.find((p) => p.id === id) ?? null;
          if (target) setDeleteProjectTarget(target);
        }}
        onImportProject={() => {
          if (!useProfileStore.getState().isLoggedIn()) {
            setProfileOpen(true);
            return;
          }
          setImportProjectOpen(true);
        }}
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
        stellarCliVersion="27.0.5"
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
              path: "src/test.rs",
              language: "rust",
              content: "#![cfg(test)]\n\nuse super::*;\nuse soroban_sdk::testutils::Address as _;\n\n#[test]\nfn test_hello() {\n    let env = Env::default();\n    let contract_id = env.register(Contract, ());\n    let client = ContractClient::new(&env, &contract_id);\n\n    let result = client.hello();\n    assert_eq!(result, String::from_str(&env, \"Hello, Soroban!\"));\n}\n",
            },
            {
              path: "Cargo.toml",
              language: "toml",
              content: `[package]\nname = "${slug}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nsoroban-sdk = "27.0.5"\n\n[dev_dependencies]\nsoroban-sdk = { version = "27.0.5", features = ["testutils"] }\n\n[profile.release]\nopt-level = "z"\noverflow-checks = true\ndebug = 0\nstrip = "symbols"\ndebug-assertions = false\npanic = "abort"\ncodegen-units = 1\nlto = true\n`,
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
        walletAddress={useProfileStore((s) => s.walletAddress)}
        walletConnected={useProfileStore((s) => s.walletConnected)}
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
  if (view === "packages") return <PackagesPanel />;
  if (view === "deploy") return <DeploySidePanel />;
  return <FileExplorer onOpenSettings={onOpenSettings} />;
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const tree = useFileSystemStore((s) => s.tree);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const openTab = useEditorTabsStore((s) => s.openTab);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);

  const results = useMemo(() => {
    if (!query.trim() || !activeProjectId || allFiles.length === 0) return [];
    const searchResults: {
      filePath: string;
      matches: { line: number; text: string; preview: string }[];
    }[] = [];
    const flags = caseSensitive ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      return [];
    }

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
  }, [query, caseSensitive, allFiles, activeProjectId]);

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  function handleResultClick(filePath: string, _line: number) {
    setActiveFile(filePath);
    openTab(filePath, filePath.split("/").pop() ?? filePath);
  }

  function handleReplaceAll() {
    if (!query.trim() || results.length === 0) return;
    const flags = caseSensitive ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      return;
    }
    for (const result of results) {
      const file = allFiles.find((f) => f.path === result.filePath);
      if (!file) continue;
      const newContent = file.content.replace(regex, replace);
      useFileSystemStore.getState().updateFileContent(file.path, newContent);
    }
    setHasSearched(true);
  }

  // No project active — show message
  if (!activeProjectId) {
    return (
      <div className="flex h-full flex-col bg-[var(--surface-panel)]">
        <div className="px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Search</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <Search size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Open a project to search across its files.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Search</span>
      </div>
      <div className="px-3 pb-2 space-y-1.5">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHasSearched(false);
          }}
          autoFocus
          placeholder="Search in project…"
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
          {query && results.length > 0 && replace && (
            <button
              onClick={handleReplaceAll}
              className="ml-auto text-[var(--accent)] hover:underline"
            >
              Replace all
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {query && results.length === 0 && allFiles.length > 0 && (
          <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
            No results found for &ldquo;{query}&rdquo;.
          </div>
        )}
        {query && allFiles.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
            No files in this project to search.
          </div>
        )}
        {!query && allFiles.length > 0 && (
          <div className="px-3 py-4 text-xs text-[var(--text-muted)] italic">
            Type to search across {allFiles.length} files…
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
  const buildStatus = useBuildStore((s) => s.status);
  const startBuild = useBuildStore((s) => s.startBuild);
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      <div className="px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Compile & Deploy
        </span>
      </div>
      {!activeProjectId ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <Rocket size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Open a project to compile and deploy.
          </p>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          <button
            onClick={() => startBuild()}
            disabled={buildStatus === "building"}
            className="w-full rounded bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
          >
            {buildStatus === "building" ? "Building…" : "stellar contract build"}
          </button>

          {wasmInfo && (
            <div className="rounded-md bg-[var(--surface-sunken)] px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
                Built WASM
              </div>
              <div className="text-[11px] font-mono text-[var(--text-primary)] truncate">
                {wasmInfo.path.split("/").pop()}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {(wasmInfo.sizeBytes / 1024).toFixed(2)} KB
              </div>
            </div>
          )}

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-2">
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Use the <span className="font-medium text-[var(--text-secondary)]">Deploy</span> tab in the right panel
              to deploy your contract to Stellar testnet.
            </p>
          </div>
        </div>
      )}
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
