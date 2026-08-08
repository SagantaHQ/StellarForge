import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerToken } from "@/lib/github/token";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, readdir, stat, rm } from "fs/promises";
import { join, extname, relative } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

/**
 * POST /api/projects/import-git
 *   Body: { repoUrl, branch?, ownerId, projectName? }
 *
 * Server-side: clones the repo to a temp dir (shallow clone, depth 1),
 * reads all text files, creates a Project + File records, then cleans up.
 *
 * Safety:
 *   - Shallow clone (--depth 1) to minimize transfer
 *   - 30-second timeout on git clone
 *   - Only text files imported (extension-based filter)
 *   - node_modules, .git, target directories excluded
 *   - Max 500 files per project
 *   - 1GB storage quota enforced
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for large repos

const FREE_TIER_QUOTA_BYTES = 1 * 1024 * 1024 * 1024;
const MAX_FILES = 500;
const CLONE_TIMEOUT_MS = 30_000;

const TEXT_EXTENSIONS = new Set([
  "rs", "toml", "ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml",
  "gitignore", "env", "sh", "bash", "zsh", "py", "go", "java", "kt", "swift",
  "c", "cpp", "h", "hpp", "cs", "rb", "php", "vue", "svelte", "css", "scss",
  "html", "xml", "sql", "graphql", "gql", "proto", "wasm", "wat", "lock",
  "dockerfile", "makefile", "cmake", "gradle",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "__MACOSX", ".next", "dist", "build",
  ".cache", "vendor", ".idea", ".vscode",
]);

function detectLanguage(ext: string): string {
  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "toml": return "toml";
    case "md": return "markdown";
    case "yaml": case "yml": return "yaml";
    case "html": return "html";
    case "css": case "scss": return "css";
    case "py": return "python";
    case "go": return "go";
    case "sql": return "sql";
    default: return "plaintext";
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `proj-${Date.now().toString(36)}`;
}

async function walkDir(
  dir: string,
  baseDir: string,
  files: { path: string; content: string; language: string }[]
): Promise<void> {
  if (files.length >= MAX_FILES) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(fullPath, baseDir, files);
    } else if (entry.isFile()) {
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTENSIONS.has(ext) && !TEXT_EXTENSIONS.has(entry.name.toLowerCase())) continue;

      // Skip large files (> 5 MB)
      const fileStat = await stat(fullPath);
      if (fileStat.size > 5 * 1024 * 1024) continue;

      try {
        const content = await readFile(fullPath, "utf8");
        const relPath = relative(baseDir, fullPath).split("\\").join("/");
        files.push({
          path: relPath,
          content,
          language: detectLanguage(ext),
        });
      } catch {
        // Binary or unreadable — skip
      }
    }
  }
}

export async function POST(req: NextRequest) {
  const tempDir = join(tmpdir(), `soroban-git-${randomUUID()}`);

  try {
    const body = await req.json();
    const { repoUrl, branch, ownerId, projectName } = body;

    if (!repoUrl || !ownerId) {
      return NextResponse.json(
        { error: "Missing required fields: repoUrl, ownerId" },
        { status: 400 }
      );
    }

    // Basic URL validation — allow https and git@ URLs
    if (!/^https?:\/\/.+\.git$|^https:\/\/github\.com\/.+\/.+$|^git@github\.com:.+\.git$/.test(repoUrl)) {
      return NextResponse.json(
        { error: "Invalid repository URL. Use HTTPS or SSH format." },
        { status: 400 }
      );
    }

    // Verify the user exists
    const user = await db.user.findUnique({ where: { id: ownerId } });
    if (!user) {
      return NextResponse.json(
        { error: "User not found — must be logged in to import a project" },
        { status: 401 }
      );
    }

    // Clone the repo (shallow). If the repo is private or the user wants
    // authenticated access, embed the server PAT in the HTTPS URL.
    // This allows cloning private repos without requiring the user to have
    // connected their own GitHub account.
    const serverToken = getServerToken();
    let cloneUrl = repoUrl;

    // Transform https://github.com/owner/repo → https://x-access-token:TOKEN@github.com/owner/repo
    if (serverToken && repoUrl.startsWith("https://github.com/")) {
      cloneUrl = repoUrl.replace(
        "https://github.com/",
        `https://x-access-token:${serverToken}@github.com/`
      );
    } else if (serverToken && repoUrl.startsWith("https://")) {
      // Generic HTTPS git host — embed token
      try {
        const parsed = new URL(repoUrl);
        cloneUrl = `${parsed.protocol}//x-access-token:${serverToken}@${parsed.host}${parsed.pathname}`;
      } catch {
        // Malformed URL — use as-is
      }
    }

    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(cloneUrl, tempDir);

    try {
      await execFileAsync("git", cloneArgs, {
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        // Don't leak the token in error messages
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/echo" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Strip the token from any error output
      const safeMessage = serverToken
        ? message.replace(new RegExp(serverToken, "g"), "[REDACTED]")
        : message;
      if (safeMessage.includes("timed out")) {
        return NextResponse.json(
          { error: "Clone timed out — the repository may be too large or unreachable." },
          { status: 504 }
        );
      }
      return NextResponse.json(
        { error: "Failed to clone repository", detail: safeMessage },
        { status: 502 }
      );
    }

    // Walk the cloned directory and collect text files
    const files: { path: string; content: string; language: string }[] = [];
    await walkDir(tempDir, tempDir, files);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No text files found in the repository." },
        { status: 422 }
      );
    }

    // Storage quota check
    const existingFiles = await db.file.findMany({
      where: {
        project: { ownerId },
        deletedAt: null,
      },
      select: { content: true },
    });
    const existingBytes = existingFiles.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0
    );
    const incomingBytes = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0
    );

    if (existingBytes + incomingBytes > FREE_TIER_QUOTA_BYTES) {
      const usedMb = (existingBytes / (1024 * 1024)).toFixed(1);
      const quotaMb = (FREE_TIER_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
      const incomingMb = (incomingBytes / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        {
          error: "Storage quota exceeded",
          detail: `You're using ${usedMb} MB of ${quotaMb} MB. This import adds ${incomingMb} MB.`,
          usage: { used: existingBytes, quota: FREE_TIER_QUOTA_BYTES, incoming: incomingBytes },
        },
        { status: 413 }
      );
    }

    // Derive project name
    const finalName = (projectName?.trim()) || (() => {
      const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
      return match?.[1] ?? "imported-project";
    })();

    // Generate unique slug
    const baseSlug = slugify(finalName);
    let slug = baseSlug;
    let suffix = 1;
    while (await db.project.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    // Create the project
    const project = await db.project.create({
      data: {
        name: finalName,
        slug,
        description: `Imported from ${repoUrl}`,
        ownerId,
        defaultBranch: branch ?? "main",
      },
    });

    await db.projectMember.create({
      data: { projectId: project.id, userId: ownerId, role: "OWNER" },
    });

    // Create file records
    await db.file.createMany({
      data: files.map((f) => ({
        projectId: project.id,
        path: f.path,
        content: f.content,
        language: f.language,
        gitStatus: "untracked",
      })),
    });

    await db.auditLog.create({
      data: {
        projectId: project.id,
        userId: ownerId,
        action: "FILE_CREATED",
        targetType: "project",
        targetId: project.id,
        metadata: { action: "project_imported_git", repoUrl, branch },
      },
    });

    return NextResponse.json(
      { project, fileCount: files.length },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to import from git", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    // Clean up the temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
