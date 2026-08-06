import { NextRequest, NextResponse } from "next/server";
import { verifySiws } from "@saganta/stellar-appkit-siws-verify";
import { db } from "@/lib/db";

/**
 * §11 — SIWS Signature Verification endpoint.
 *
 * Uses @saganta/stellar-appkit-siws-verify which handles:
 *   - Parsing the SIWS message (domain, nonce, expiry)
 *   - Checking domain + nonce + expiry
 *   - Verifying the ed25519 signature
 *   - SEP-0053 message encoding (Freighter signs sha256 of prefixed message)
 *
 * The library accepts `signedData` (the SEP-0053 hash from the connector)
 * and handles verification internally — no custom verifySignatureFn needed.
 *
 * POST /api/auth/verify-siws
 * Body: { message, signedMessage, signerAddress, signedData?, nonce, username, ... }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, signedMessage, signerAddress, signedData, nonce, username, displayName, bio } = body;

    if (!message || !signedMessage || !signerAddress || !nonce) {
      return NextResponse.json(
        { error: "Missing required SIWS fields: message, signedMessage, signerAddress, nonce" },
        { status: 400 }
      );
    }

    if (!username) {
      return NextResponse.json(
        { error: "Missing username — the SIWS proof is for setting a username" },
        { status: 400 }
      );
    }

    // Derive the expected domain from the request — matches what the client
    // used in window.location.hostname when building the SIWS message.
    const origin = req.headers.get("origin") || req.headers.get("host") || "";
    const expectedDomain = origin
      .replace(/^https?:\/\//, "")
      .replace(/^\/+/, "")
      .split("/")[0]
      .split(":")[0];

    // §11 — Verify using the library. Pass signedData for SEP-0053 wallets
    // (Freighter). The library handles signature verification internally.
    const result = await verifySiws(
      { message, signedMessage, signerAddress, signedData },
      { expectedDomain, expectedNonce: nonce }
    );

    if (!result.ok) {
      console.log("[SIWS] Verification failed:", result.reason);
      return NextResponse.json(
        { error: "SIWS verification failed", reason: result.reason },
        { status: 401 }
      );
    }

    console.log("[SIWS] Verification passed for:", signerAddress.substring(0, 12));

    // Verification passed — save the profile
    const usernameLower = username.toLowerCase().trim();

    if (usernameLower.length < 3 || !/^[a-z0-9_]+$/i.test(usernameLower)) {
      return NextResponse.json(
        { error: "Invalid username: must be 3+ chars, letters/numbers/underscore only" },
        { status: 400 }
      );
    }

    // Check username uniqueness
    const existing = await db.profile.findUnique({
      where: { username: usernameLower },
    });
    if (existing && existing.userId !== signerAddress) {
      return NextResponse.json(
        { error: "Username already taken", field: "username" },
        { status: 409 }
      );
    }

    // Upsert user
    const user = await db.user.upsert({
      where: { walletAddress: signerAddress },
      update: { lastSeenAt: new Date() },
      create: {
        walletAddress: signerAddress,
        email: null,
        lastSeenAt: new Date(),
      },
    });

    // Create or update profile
    const profile = await db.profile.upsert({
      where: { userId: user.id },
      update: {
        username: usernameLower,
        displayName: displayName || null,
        bio: bio || null,
      },
      create: {
        userId: user.id,
        username: usernameLower,
        displayName: displayName || null,
        bio: bio || null,
      },
    });

    // Audit log (best-effort)
    try {
      await db.auditLog.create({
        data: {
          projectId: "default",
          userId: user.id,
          action: "SHARE_GRANTED",
          targetType: "user",
          targetId: user.id,
          metadata: {
            username: usernameLower,
            action: "profile_created_via_siws",
            siwsVerified: true,
            signerAddress,
          },
        },
      });
    } catch {
      // Audit log is best-effort
    }

    return NextResponse.json({
      verified: true,
      user: { id: user.id, walletAddress: user.walletAddress },
      profile: { id: profile.id, username: profile.username },
      claims: result.claims,
    }, { status: 201 });
  } catch (err) {
    console.error("[SIWS] Error:", err);
    return NextResponse.json(
      {
        error: "Verification failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
