import { NextRequest, NextResponse } from "next/server";
import { verifySiws } from "@saganta/stellar-appkit-siws-verify";
import { db } from "@/lib/db";

/**
 * POST /api/auth/login
 *
 * Verifies the SIWS signature and creates/updates a session for the user.
 * This does NOT require a username — it just proves wallet ownership.
 *
 * After login, the client checks if the user has a profile:
 *   - If yes → fully logged in
 *   - If no → open the profile modal to complete registration
 *
 * Flow:
 *   1. Wallet connects (sc-connect event)
 *   2. Client calls signInWithStellar() → wallet signs a message
 *   3. Client POSTs the SIWS result here
 *   4. Server verifies the signature
 *   5. Server upserts the User record (creates if doesn't exist)
 *   6. Server returns { loggedIn, user, profile }
 *   7. Client checks if profile exists → opens profile modal if not
 *
 * Body:
 *   { message, signedMessage, signerAddress, signedData?, nonce }
 *
 * Returns:
 *   { loggedIn: true, user: { id, walletAddress }, profile: { username, ... } | null }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, signedMessage, signerAddress, signedData, nonce } = body;

    if (!message || !signedMessage || !signerAddress || !nonce) {
      return NextResponse.json(
        { error: "Missing required SIWS fields: message, signedMessage, signerAddress, nonce" },
        { status: 400 }
      );
    }

    // Derive the expected domain from the request
    const origin = req.headers.get("origin") || req.headers.get("host") || "";
    const expectedDomain = origin
      .replace(/^https?:\/\//, "")
      .replace(/^\/+/, "")
      .split("/")[0]
      .split(":")[0];

    // Verify the SIWS signature
    const result = await verifySiws(
      { message, signedMessage, signerAddress, signedData },
      { expectedDomain, expectedNonce: nonce }
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: "SIWS verification failed", reason: result.reason },
        { status: 401 }
      );
    }

    // Verification passed — upsert the User record
    const user = await db.user.upsert({
      where: { walletAddress: signerAddress },
      update: { lastSeenAt: new Date() },
      create: {
        walletAddress: signerAddress,
        email: null,
        lastSeenAt: new Date(),
      },
      include: {
        profile: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
          },
        },
      },
    });

    return NextResponse.json({
      loggedIn: true,
      user: { id: user.id, walletAddress: user.walletAddress },
      profile: user.profile
        ? {
            username: user.profile.username,
            displayName: user.profile.displayName,
            avatarUrl: user.profile.avatarUrl,
            bio: user.profile.bio,
          }
        : null,
      needsProfile: !user.profile,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Login failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
