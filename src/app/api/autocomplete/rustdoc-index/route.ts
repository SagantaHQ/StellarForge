import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * GET /api/autocomplete/rustdoc-index
 *
 * Returns the pre-built rustdoc symbol index for soroban-sdk.
 *
 * Soroban contracts use #![no_std], so they DON'T have access to the Rust
 * standard library (std). They only use soroban_sdk, which provides its own
 * String, Vec, Map, etc. So we only serve the soroban-sdk index.
 *
 * The index is built once by:
 *   - scripts/build-soroban-rustdoc.sh (soroban-sdk from source)
 *
 * Size: ~12 KB gzipped (366 symbols with full signatures)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INDEX_DIR = path.join(process.cwd(), "data", "rustdoc-index");

export async function GET() {
  try {
    const sdkPath = path.join(INDEX_DIR, "soroban-sdk-index.json");

    try {
      const data = await fs.readFile(sdkPath, "utf-8");
      return NextResponse.json(JSON.parse(data));
    } catch {
      return NextResponse.json(
        { error: "soroban-sdk index not built yet. Run scripts/build-soroban-rustdoc.sh" },
        { status: 503 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load rustdoc index", detail: String(err) },
      { status: 500 }
    );
  }
}
