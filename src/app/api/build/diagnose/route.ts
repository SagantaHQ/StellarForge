import { NextResponse } from "next/server";

/**
 * Build environment diagnostic.
 *
 * Returns whether the stellar CLI + cargo are installed, their paths and
 * versions, and whether the workspace dir is writable. The client can call
 * this to surface a clear "stellar CLI not installed" error before the user
 * even clicks Build.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { existsSync } = await import("fs");
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const home = process.env.HOME ?? "/home/z";
  const cargoBin = `${home}/.cargo/bin`;

  const searched = {
    stellar: [
      `${cargoBin}/stellar`,
      `/usr/local/bin/stellar`,
      `/usr/bin/stellar`,
    ],
    cargo: [
      `${cargoBin}/cargo`,
      `/usr/local/bin/cargo`,
      `/usr/bin/cargo`,
    ],
    rustc: [
      `${cargoBin}/rustc`,
      `/usr/local/bin/rustc`,
      `/usr/bin/rustc`,
    ],
  };

  const result: Record<string, { installed: boolean; path?: string; version?: string; searched: string[] }> = {};

  for (const [bin, paths] of Object.entries(searched)) {
    const found = paths.find((p) => existsSync(p));
    let version: string | undefined;
    if (found) {
      try {
        const { stdout } = await execFileAsync(found, ["--version"], {
          timeout: 5000,
          env: { ...process.env, CARGO_HOME: `${home}/.cargo`, RUSTUP_HOME: `${home}/.rustup` },
        });
        version = stdout.trim();
      } catch {
        version = "(failed to get version)";
      }
    }
    result[bin] = { installed: !!found, path: found, version, searched: paths };
  }

  // Check that the workspace dir is writable
  const buildsDir = "/tmp/soroban-builds";
  let writable = false;
  try {
    const fs = await import("fs/promises");
    await fs.mkdir(buildsDir, { recursive: true });
    await fs.writeFile(`${buildsDir}/.write-test`, "ok");
    await fs.unlink(`${buildsDir}/.write-test`);
    writable = true;
  } catch {
    writable = false;
  }

  return NextResponse.json({
    ok: result.stellar.installed,
    binaries: result,
    buildsDir: { path: buildsDir, writable },
  });
}
