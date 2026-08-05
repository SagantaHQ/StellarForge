import { NextRequest, NextResponse } from "next/server";

/**
 * §3 / §7 — Build API (start).
 *
 * Starts a `cargo build --target wasm32v1-none --release` (or
 * `soroban contract build`) in the background and returns a build ID.
 * The client polls /api/build/status?id=<buildId> to get output lines.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUILDS_DIR = "/tmp/soroban-builds";

interface BuildLine {
  type: "stdout" | "stderr";
  text: string;
  ts: number;
}

interface BuildJob {
  id: string;
  projectId: string;
  status: "building" | "success" | "failed";
  lines: BuildLine[];
  wasmInfo?: { path: string; sizeBytes: number };
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

// Use a Map on globalThis to persist across HMR reloads without
// breaking Turbopack (declare global was causing issues)
const g = globalThis as unknown as { __buildJobs?: Map<string, BuildJob> };
if (!g.__buildJobs) g.__buildJobs = new Map();
const buildJobs = g.__buildJobs;

export async function POST(req: NextRequest) {
  let body: {
    projectId: string;
    files: { path: string; content: string }[];
    command?: "soroban" | "cargo";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projectId || !Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json(
      { error: "Missing projectId or files" },
      { status: 400 }
    );
  }

  const command = body.command ?? "soroban";

  const { spawn } = await import("child_process");
  const path = await import("path");
  const fs = await import("fs/promises");

  const home = process.env.HOME ?? "/home/z";
  const cargoBin = `${home}/.cargo/bin`;
  const env = {
    ...process.env,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
    CARGO_HOME: `${home}/.cargo`,
    RUSTUP_HOME: `${home}/.rustup`,
  };

  // Set up workspace
  let workspaceDir: string;
  try {
    workspaceDir = path.join(BUILDS_DIR, body.projectId);
    await fs.mkdir(workspaceDir, { recursive: true });
    for (const file of body.files) {
      const filePath = path.join(workspaceDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, "utf-8");
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to set up workspace", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const args =
    command === "soroban"
      ? ["contract", "build", "--wasm32v1-none"]
      : ["build", "--target", "wasm32v1-none", "--release"];

  const buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: BuildJob = {
    id: buildId,
    projectId: body.projectId,
    status: "building",
    lines: [],
    startedAt: Date.now(),
  };
  buildJobs.set(buildId, job);

  // Spawn the build
  try {
    const child = spawn(command, args, {
      cwd: workspaceDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split("\n").filter((l) => l.length > 0);
      for (const line of lines) {
        job.lines.push({ type: "stdout", text: line, ts: Date.now() });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split("\n").filter((l) => l.length > 0);
      for (const line of lines) {
        job.lines.push({ type: "stderr", text: line, ts: Date.now() });
      }
    });

    child.on("error", (err) => {
      job.status = "failed";
      job.error = err.message;
      job.finishedAt = Date.now();
    });

    child.on("close", (code) => {
      job.status = code === 0 ? "success" : "failed";
      if (code !== 0) {
        job.error = `Build failed with exit code ${code}`;
      }
      job.finishedAt = Date.now();

      if (code === 0) {
        findWasm(workspaceDir)
          .then(async (wasmPath) => {
            if (wasmPath) {
              const stat = await fs.stat(wasmPath);
              job.wasmInfo = {
                path: wasmPath.replace(workspaceDir + "/", ""),
                sizeBytes: stat.size,
              };
            }
          })
          .catch(() => {});
      }
    });
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
  }

  return NextResponse.json({
    buildId,
    status: "building",
    message: "Build started. Poll /api/build/status?id=<buildId> for updates.",
  });

  async function findWasm(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".wasm")) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = await findWasm(fullPath);
        if (found) return found;
      }
    }
    return null;
  }
}
