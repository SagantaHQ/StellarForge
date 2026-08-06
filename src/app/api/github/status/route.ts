import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/github/status?walletAddress=GXXX
 *
 * Checks whether the user has connected their GitHub account.
 * Returns:
 *   { connected: boolean, username: string | null, connectedAt: string | null }
 *
 * Also disconnects (clears the token) if ?disconnect=1 is passed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { walletAddress },
      select: {
        githubAccessToken: true,
        githubUsername: true,
        githubConnectedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      connected: !!user.githubAccessToken,
      username: user.githubUsername,
      connectedAt: user.githubConnectedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to check GitHub status", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/github/status?walletAddress=GXXX
 *
 * Disconnects GitHub by clearing the access token from the user record.
 */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { walletAddress },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        githubAccessToken: null,
        githubUsername: null,
        githubConnectedAt: null,
      },
    });

    return NextResponse.json({ success: true, disconnected: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to disconnect GitHub", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
