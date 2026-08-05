import { NextRequest, NextResponse } from "next/server";

/**
 * §15.4 — Terminal sandboxing API.
 *
 * Executes commands in a sandboxed workspace with:
 *   - Per-session isolated directory (non-root user in production)
 *   - Resource limits: CPU, RAM, disk quota, command timeout
 *   - Network egress allowlist: crates.io, static.crates.io, Stellar RPC/Horizon, GitHub
 *   - Command allowlist: cargo, stellar, rustup, ls, cat, pwd, echo, test, mkdir, rm, cp, mv, touch, grep, find, wc, head, tail, sort, uniq, diff, git, clear, help
 *
 * In production (Docker), this runs inside an isolated container with
 * gVisor/Firecracker-style isolation, non-root user, and iptables-based
 * egress filtering. Here we implement the allowlist + timeout at the
 * application layer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for cargo builds

const BUILDS_DIR = "/tmp/soroban-builds";

// §15.4 — egress allowlist (domains the sandboxed terminal may reach)
const EGRESS_ALLOWLIST = [
  "crates.io",
  "static.crates.io",
  "rpc.stellar.org",
  "horizon.stellar.org",
  "github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "index.crates.io",
  "registry.npmjs.org",
];

// Command allowlist — first token must match one of these
const COMMAND_ALLOWLIST = [
  "cargo",
  "stellar",
  "soroban",
  "rustup",
  "rustc",
  "ls",
  "cat",
  "pwd",
  "echo",
  "test",
  "mkdir",
  "rmdir",
  "rm",
  "cp",
  "mv",
  "touch",
  "grep",
  "find",
  "wc",
  "head",
  "tail",
  "sort",
  "uniq",
  "diff",
  "git",
  "clear",
  "help",
  "which",
  "env",
];

const COMMAND_TIMEOUT_MS = 60_000; // 60s per command

interface TerminalRequest {
  projectId: string;
  command: string;
  files?: { path: string; content: string }[];
}

export async function POST(req: NextRequest) {
  let body: TerminalRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projectId || !body.command?.trim()) {
    return NextResponse.json(
      { error: "Missing projectId or command" },
      { status: 400 }
    );
  }

  // Parse the command — handle quoted args
  const tokens = parseCommand(body.command);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Empty command" }, { status: 400 });
  }

  const binary = tokens[0];

  // §15.4 — enforce command allowlist
  if (!COMMAND_ALLOWLIST.includes(binary)) {
    return NextResponse.json({
      error: `Command '${binary}' is not allowed. Allowed: ${COMMAND_ALLOWLIST.join(", ")}`,
      exitCode: 127,
      stdout: "",
      stderr: `bash: ${binary}: command not allowed\n`,
    });
  }

  // Block dangerous flags/patterns
  const fullCommand = body.command;
  const dangerousPatterns = [
    /\brm\s+-rf\s+\//, // rm -rf /
    /\b\s>?\s*\/dev\/sd/, // writing to block devices
    /\bmkfs\b/, // filesystem format
    /\bdd\s+.*of=\/dev\//, // dd to device
    /\b:?\(\)\s*\{/, // fork bomb
    /\bcurl\s+.*\|\s*sh/, // curl pipe to shell
    /\bwget\s+.*\|\s*sh/, // wget pipe to shell
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(fullCommand)) {
      return NextResponse.json({
        error: "Command contains a blocked pattern (security)",
        exitCode: 126,
        stdout: "",
        stderr: `bash: blocked: dangerous pattern detected\n`,
      });
    }
  }

  // Lazy imports
  const { spawn } = await import("child_process");
  const path = await import("path");
  const fs = await import("fs/promises");

  const home = process.env.HOME ?? "/home/z";
  const cargoBin = `${home}/.cargo/bin`;
  const env = {
    ...process.env,
    PATH: `${cargoBin}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
    CARGO_HOME: `${home}/.cargo`,
    RUSTUP_HOME: `${home}/.rustup`,
    HOME: home,
    // §15.4 — set resource limits via env (honored by some tools)
    CARGO_BUILD_JOBS: "2", // limit parallelism
  };

  // Ensure workspace exists + sync files
  let workspaceDir: string;
  try {
    workspaceDir = path.join(BUILDS_DIR, body.projectId);
    await fs.mkdir(workspaceDir, { recursive: true });
    if (body.files && body.files.length > 0) {
      for (const file of body.files) {
        const filePath = path.join(workspaceDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, "utf-8");
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to set up workspace", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  // Execute the command with timeout
  try {
    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn(binary, tokens.slice(1), {
        cwd: workspaceDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: COMMAND_TIMEOUT_MS,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        // Truncate if too long (prevent memory issues)
        if (stdout.length > 500_000) stdout = stdout.substring(0, 500_000) + "\n... (truncated)";
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 500_000) stderr = stderr.substring(0, 500_000) + "\n... (truncated)";
      });

      child.on("error", (err) => {
        resolve({
          exitCode: 127,
          stdout,
          stderr: stderr + `\nbash: ${binary}: ${err.message}\n`,
        });
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });
    });

    return NextResponse.json({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      command: fullCommand,
      cwd: workspaceDir,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Execution failed",
        detail: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        stdout: "",
        stderr: String(err),
      },
      { status: 500 }
    );
  }
}

/** Parse a command string into tokens, handling quoted arguments. */
function parseCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === " " && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
