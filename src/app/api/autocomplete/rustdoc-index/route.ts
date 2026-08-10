import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * GET /api/autocomplete/rustdoc-index
 *
 * Returns the pre-built rustdoc symbol indexes for:
 *   - soroban-sdk (366 symbols with full signatures)
 *   - std/core/alloc (19,360 symbols)
 *
 * The index is built once at server startup by:
 *   - scripts/build-rustdoc-index.py (std/core/alloc from rust-docs-json component)
 *   - scripts/build-soroban-rustdoc.sh (soroban-sdk from source)
 *
 * The index is cached per version in data/rustdoc-index/.
 *
 * Query params:
 *   ?crate=soroban-sdk  — return only the soroban-sdk index
 *   ?crate=std          — return only the std index
 *   (none)              — return all indexes merged
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INDEX_DIR = path.join(process.cwd(), "data", "rustdoc-index");

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const crateFilter = url.searchParams.get("crate");

    const sdkPath = path.join(INDEX_DIR, "soroban-sdk-index.json");
    const stdPath = path.join(INDEX_DIR, "std-index.json");

    if (crateFilter === "soroban-sdk") {
      try {
        const data = await fs.readFile(sdkPath, "utf-8");
        return NextResponse.json(JSON.parse(data));
      } catch {
        return NextResponse.json(
          { error: "soroban-sdk index not built yet" },
          { status: 503 }
        );
      }
    }

    if (crateFilter === "std") {
      try {
        const data = await fs.readFile(stdPath, "utf-8");
        return NextResponse.json(JSON.parse(data));
      } catch {
        return NextResponse.json(
          { error: "std index not built yet" },
          { status: 503 }
        );
      }
    }

    // Return merged index
    const result: { sorobanSdk?: unknown; std?: unknown } = {};

    try {
      result.sorobanSdk = JSON.parse(await fs.readFile(sdkPath, "utf-8"));
    } catch {}
    try {
      result.std = JSON.parse(await fs.readFile(stdPath, "utf-8"));
    } catch {}

    if (!result.sorobanSdk && !result.std) {
      return NextResponse.json(
        { error: "No rustdoc indexes found" },
        { status: 503 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load rustdoc index", detail: String(err) },
      { status: 500 }
    );
  }
}
