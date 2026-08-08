import { NextRequest, NextResponse } from "next/server";

/**
 * §3 / §7 — Build API (start).
 *
 * Spawns `stellar contract build` (or `cargo build`) in a pseudo-TTY so
 * stdout/stderr are line-buffered (cargo block-buffers when piped, which
 * otherwise means zero output until the process exits). The client polls
 * /api/build/status?id=<buildId> for accumulated output lines.
 *
 * If the stellar CLI is not installed, returns HTTP 503 with a clear error
 * so the client can surface it immediately (instead of silently polling a
 * non-existent job and showing "building" forever).
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

/**
 * Resolve the absolute path of a binary on the system PATH.
 * Returns null if not found.
 */
async function resolveBinary(name: string): Promise<string | null> {
  const { existsSync } = await import("fs");
  const home = process.env.HOME ?? "/home/z";
  const candidates = [
    `${home}/.cargo/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/bin/${name}`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: {
    projectId: string;
    files: { path: string; content: string }[];
    command?: "stellar" | "cargo";
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

  const { spawn } = await import("child_process");
  const path = await import("path");
  const fs = await import("fs/promises");

  const home = process.env.HOME ?? "/home/z";
  const cargoBin = `${home}/.cargo/bin`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
    CARGO_HOME: `${home}/.cargo`,
    RUSTUP_HOME: `${home}/.rustup`,
    // Force cargo to emit progress lines even though stdout is piped
    CARGO_TERM_COLOR: "never",
    CARGO_TERM_PROGRESS_WHEN: "always",
    // Force rustc to emit colorless output (we colorize in the UI)
    RUSTC_BOOTSTRAP: "1",
    // Disable incremental compilation to reduce disk usage in /tmp
    CARGO_INCREMENTAL: "0",
  };

  // Determine the build command:
  // - "stellar" (default): `stellar contract build` — the canonical Soroban build
  // - "cargo": `cargo build` — compiles dependencies without producing a wasm
  //   Useful for checking that Cargo.toml changes compile correctly
  const useCargo = body.command === "cargo";
  const buildCommand = useCargo ? "cargo" : "stellar";
  const args = useCargo ? ["build"] : ["contract", "build"];

  // Verify the CLI is installed — return HTTP 503 so the client can show
  // the error immediately instead of polling a non-existent build job.
  const cliPath = await resolveBinary(buildCommand);
  if (!cliPath) {
    return NextResponse.json(
      {
        error: `${buildCommand} CLI not installed on the server`,
        detail:
          useCargo
            ? `Run: cargo install`
            : `Run: cargo install stellar-cli`,
        cli: buildCommand,
        searched: [
          `${home}/.cargo/bin/${buildCommand}`,
          `/usr/local/bin/${buildCommand}`,
          `/usr/bin/${buildCommand}`,
        ],
      },
      { status: 503 }
    );
  }

  // Set up workspace
  let workspaceDir: string;
  try {
    workspaceDir = path.join(BUILDS_DIR, body.projectId);
    await fs.rm(workspaceDir, { recursive: true, force: true });
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

  const buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: BuildJob = {
    id: buildId,
    projectId: body.projectId,
    status: "building",
    lines: [
      {
        type: "stdout",
        text: `$ ${buildCommand} ${args.join(" ")}   (cwd: ${workspaceDir})`,
        ts: Date.now(),
      },
      {
        type: "stdout",
        text: `Using: ${cliPath}`,
        ts: Date.now(),
      },
    ],
    startedAt: Date.now(),
  };
  buildJobs.set(buildId, job);

  // Spawn the build inside a pseudo-TTY so cargo flushes output line-by-line.
  //
  // Background: cargo (and stellar-cli, which wraps cargo) detects whether
  // stdout is a TTY. When piped (as we do here), it switches to block-buffered
  // I/O and only flushes when the 4KB buffer fills or the process exits.
  // For long-running compiles this means ZERO output appears until the very
  // end — which is the "stuck on building with no logs" symptom.
  //
  // `script -qec '<command>' /dev/null` allocates a pseudo-TTY, so cargo
  // thinks it's talking to a real terminal and flushes each line as it's
  // written. The `-q` flag suppresses the "Script started" / "Script done"
  // boilerplate, and `-e` makes script exit with the child's exit code.
  try {
    const shellCommand = `${buildCommand} ${args.map((a) => `'${a}'`).join(" ")}`;
    const child = spawn("script", ["-qec", shellCommand, "/dev/null"], {
      cwd: workspaceDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Buffer for incomplete lines (PTY output may not be newline-terminated)
    let stdoutBuf = "";
    let stderrBuf = "";

    function flushBuffer(buf: string, type: "stdout" | "stderr"): string {
      const lines = buf.split("\n");
      // Last element is the incomplete remainder
      const remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) {
          // Strip ANSI escape sequences (script passes through raw bytes,
          // and even with CARGO_TERM_COLOR=never some ANSI may leak through)
          const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
          if (clean.length > 0) {
            job.lines.push({ type, text: clean, ts: Date.now() });
          }
        }
      }
      return remainder;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      stdoutBuf = flushBuffer(stdoutBuf, "stdout");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      stderrBuf = flushBuffer(stderrBuf, "stderr");
    });

    child.on("error", (err) => {
      job.lines.push({ type: "stderr", text: `Failed to spawn build: ${err.message}`, ts: Date.now() });
      job.status = "failed";
      job.error = err.message;
      job.finishedAt = Date.now();
    });

    child.on("close", (code) => {
      // Flush any remaining buffered content
      if (stdoutBuf.length > 0) flushBuffer(stdoutBuf + "\n", "stdout");
      if (stderrBuf.length > 0) flushBuffer(stderrBuf + "\n", "stderr");

      job.status = code === 0 ? "success" : "failed";
      if (code !== 0) {
        job.error = `Build failed with exit code ${code}`;
        job.lines.push({ type: "stderr", text: job.error, ts: Date.now() });
      } else {
        job.lines.push({ type: "stdout", text: `Build succeeded (exit code 0)`, ts: Date.now() });
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
              job.lines.push({
                type: "stdout",
                text: `WASM: ${job.wasmInfo.path} (${(stat.size / 1024).toFixed(2)} KB)`,
                ts: Date.now(),
              });
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
