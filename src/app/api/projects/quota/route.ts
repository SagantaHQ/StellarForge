import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/projects/quota?ownerId=X
 *
 * Returns the user's current storage usage and quota limit.
 *   { used: number, quota: number, percent: number }
 *
 * Free tier: 1 GB. Pro tier (TBD) will be higher.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREE_TIER_QUOTA_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ownerId = url.searchParams.get("ownerId");

    if (!ownerId) {
      return NextResponse.json({ error: "Missing ownerId" }, { status: 400 });
    }

    const files = await db.file.findMany({
      where: {
        project: { ownerId },
        deletedAt: null,
      },
      select: { content: true },
    });

    const used = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0
    );

    return NextResponse.json({
      used,
      quota: FREE_TIER_QUOTA_BYTES,
      percent: Math.min(100, (used / FREE_TIER_QUOTA_BYTES) * 100),
      tier: "free",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch quota", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
