import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/users/search?q=username
 *
 * Searches for users by username (case-insensitive, partial match).
 * Used by the Live Collab invite autocomplete.
 *
 * Returns up to 10 matching users with username + avatar.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();

    if (!q || q.length < 1) {
      return NextResponse.json({ users: [] });
    }

    const users = await db.profile.findMany({
      where: {
        username: {
          contains: q.toLowerCase(),
          mode: "insensitive",
        },
      },
      select: {
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      take: 10,
      orderBy: { username: "asc" },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to search users", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
