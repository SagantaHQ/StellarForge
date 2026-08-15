import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * SIWS Session check endpoint.
 *
 * Called by the stellar-appkit client's `siws.session` callback immediately
 * after the wallet connects. If we already have a valid (non-expired)
 * SiwsSession for this address, return it — the SDK will skip the sign-in
 * flow and use this session directly.
 *
 * Query params:
 *   ?address=<walletAddress>
 *
 * Returns:
 *   - 200 with a SiwsSession JSON body if a valid session exists
 *   - 200 with null body if no session / session expired / address mismatch
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Neon cold start can be slow

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get("address");

    if (!address) {
      return new NextResponse("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Look up the user by wallet address
    const user = await db.user.findUnique({
      where: { walletAddress: address },
      include: {
        profile: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
            isCustomUsername: true,
          },
        },
      },
    });

    // No user record → no session
    if (!user) {
      return new NextResponse("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check session freshness — if the user hasn't been seen in > SESSION_TTL,
    // consider the session expired.
    const now = Date.now();
    const lastSeen = user.lastSeenAt ? user.lastSeenAt.getTime() : 0;
    if (now - lastSeen > SESSION_TTL_MS) {
      return new NextResponse("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build the SiwsSession — the SDK will validate address + network + expiry
    const siwsSession = {
      network: "TESTNET",
      address: user.walletAddress,
      expiry: lastSeen + SESSION_TTL_MS,
      metadata: {
        userId: user.id,
        username: user.profile?.username,
        displayName: user.profile?.displayName,
        avatarUrl: user.profile?.avatarUrl,
        bio: user.profile?.bio,
        isCustomUsername: user.profile?.isCustomUsername ?? false,
      },
    };

    return NextResponse.json(siwsSession, { status: 200 });
  } catch (err) {
    console.error("[SIWS] Session check error:", err);
    return new NextResponse("null", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
