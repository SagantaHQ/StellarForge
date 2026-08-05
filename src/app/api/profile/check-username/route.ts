import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §11 — Username uniqueness check.
 *
 * Called by the profile modal's debounced input. Returns whether a username
 * is available (not taken by another user).
 *
 * GET /api/profile/check-username?u=<username>
 * → { available: boolean, username: string }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("u")?.trim().toLowerCase();

    if (!username) {
      return NextResponse.json({ error: "Missing username" }, { status: 400 });
    }

    if (username.length < 3 || !/^[a-z0-9_]+$/i.test(username)) {
      return NextResponse.json({
        available: false,
        username,
        reason: "invalid",
        message: "Must be 3+ chars, letters/numbers/underscore only",
      });
    }

    const existing = await db.profile.findUnique({
      where: { username },
      select: { id: true, userId: true },
    });

    return NextResponse.json({
      available: !existing,
      username,
      reason: existing ? "taken" : "available",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Check failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
