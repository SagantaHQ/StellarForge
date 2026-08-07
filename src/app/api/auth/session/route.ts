import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §11 — Session management API.
 *
 * POST /api/auth/session — create/refresh a session after wallet connect.
 *   Body: { address }
 *   Returns: { loggedIn: boolean, user, profile }
 *
 * GET /api/auth/session — check if session is valid.
 *   Query: ?address=GXXX
 *   Returns: { loggedIn: boolean, user, profile }
 *
 * The session is stored in the User table (lastSeenAt) — in production
 * this would use JWT or session cookies, but the pattern is the same:
 * the client checks this endpoint to know if the user is "logged in"
 * and all cloud features (comments, collab, line attribution) are gated
 * behind a valid session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get("address");

    if (!address) {
      return NextResponse.json({ loggedIn: false });
    }

    // Check if this wallet address has a profile in the DB
    const user = await db.user.findUnique({
      where: { walletAddress: address },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      return NextResponse.json({ loggedIn: false });
    }

    // Update lastSeenAt
    await db.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return NextResponse.json({
      loggedIn: true,
      user: { id: user.id, walletAddress: user.walletAddress },
      profile: {
        username: user.profile.username,
        displayName: user.profile.displayName,
        avatarUrl: user.profile.avatarUrl,
        bio: user.profile.bio,
        isCustomUsername: user.profile.isCustomUsername,
      },
    });
  } catch {
    return NextResponse.json({ loggedIn: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    // Check if user exists with this wallet address
    const user = await db.user.findUnique({
      where: { walletAddress: address },
      include: { profile: true },
    });

    if (!user) {
      // User doesn't exist yet — not logged in (needs to complete profile)
      return NextResponse.json({ loggedIn: false, needsProfile: true });
    }

    if (!user.profile) {
      // User exists but no profile — needs to set username
      return NextResponse.json({ loggedIn: false, needsProfile: true });
    }

    // Valid session — update lastSeenAt
    await db.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return NextResponse.json({
      loggedIn: true,
      user: { id: user.id, walletAddress: user.walletAddress },
      profile: {
        username: user.profile.username,
        displayName: user.profile.displayName,
        avatarUrl: user.profile.avatarUrl,
        bio: user.profile.bio,
        isCustomUsername: user.profile.isCustomUsername,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Session check failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
