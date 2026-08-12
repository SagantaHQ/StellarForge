import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * POST /api/autocomplete/build-deps
 *
 * Generates rustdoc symbol indexes for all dependencies in a project's Cargo.toml.
 * Each dep's index is cached per package@version in data/rustdoc-index/.
 *
 * Body: { cargoToml: string }
 *
 * Flow:
 *   1. Parse [dependencies] and [dev-dependencies] from Cargo.toml
 *   2. For each dep, check if a cached index exists
 *   3. If not, run scripts/build-dep-rustdoc.sh to generate it
 *   4. Return all indexes merged (soroban-sdk + all deps)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Index directory — use /tmp (OUTSIDE the project) so writes don't
// trigger Next.js file-watcher reloads. The index is a cache; if /tmp
// is cleared, it regenerates on next build.
const INDEX_DIR = path.join("/tmp", "soroban-rustdoc-index");

interface CargoDep {
  name: string;
  version: string;
}

function parseCargoDeps(cargoToml: string): CargoDep[] {
  const deps: CargoDep[] = [];
  const lines = cargoToml.split("\n");
  let inDepsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[dependencies]" || trimmed === "[dev-dependencies]") {
      inDepsSection = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDepsSection = false;
      continue;
    }
    if (!inDepsSection) continue;

    const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (simpleMatch) {
      deps.push({ name: simpleMatch[1], version: simpleMatch[2] });
      continue;
    }
    const tableMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    if (tableMatch) {
      deps.push({ name: tableMatch[1], version: tableMatch[2] });
      continue;
    }
  }
  return deps;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cargoToml } = body as { cargoToml: string };

    if (!cargoToml) {
      return NextResponse.json({ error: "Missing cargoToml" }, { status: 400 });
    }

    const deps = parseCargoDeps(cargoToml);

    if (deps.length === 0) {
      return NextResponse.json({ ok: true, deps: [], indexes: [] });
    }

    await fs.mkdir(INDEX_DIR, { recursive: true });

    const results: Array<{ name: string; version: string; status: string; symbolCount?: number }> = [];
    const indexes: Array<{ crate: string; version: string; symbols: unknown[]; total_count: number }> = [];

    for (const dep of deps) {
      // Skip soroban-sdk — it's already indexed separately by build-soroban-rustdoc.sh
      // and served as soroban-sdk-index.json
      if (dep.name === "soroban-sdk" || dep.name === "soroban_sdk") continue;

      const indexName = dep.name.replace(/-/g, "_");
      const indexFile = path.join(INDEX_DIR, `${indexName}-${dep.version}.json`);

      // Check cache first
      try {
        const data = await fs.readFile(indexFile, "utf-8");
        const parsed = JSON.parse(data);
        results.push({ name: dep.name, version: dep.version, status: "cached", symbolCount: parsed.total_count });
        indexes.push(parsed);
        continue;
      } catch {
        // Not cached — generate
      }

      try {
        const scriptPath = path.join(process.cwd(), "scripts", "build-dep-rustdoc.sh");
        await execFileAsync("bash", [scriptPath, dep.name, dep.version], {
          timeout: 180_000,
          env: { ...process.env, HOME: process.env.HOME || "/home/z" },
        });

        try {
          const data = await fs.readFile(indexFile, "utf-8");
          const parsed = JSON.parse(data);
          results.push({ name: dep.name, version: dep.version, status: "generated", symbolCount: parsed.total_count });
          indexes.push(parsed);
        } catch {
          results.push({ name: dep.name, version: dep.version, status: "failed" });
        }
      } catch (err) {
        console.warn(`[autocomplete] failed for ${dep.name}:`, err);
        results.push({ name: dep.name, version: dep.version, status: "failed" });
      }
    }

    return NextResponse.json({ ok: true, deps: results, indexes });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to build dep indexes", detail: String(err) },
      { status: 500 }
    );
  }
}
