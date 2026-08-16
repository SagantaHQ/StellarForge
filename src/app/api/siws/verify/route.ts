import { NextRequest, NextResponse } from "next/server";
import { verifySiws } from "@saganta/stellar-appkit-siws-verify";
import { db } from "@/lib/db";
import { generateUniqueUsername } from "@/lib/username-generator";
import { consumeNonce } from "../nonce/route";

/**
 * SIWS Verify endpoint.
 *
 * Called by the stellar-appkit client's `siws.verify` callback after the
 * wallet signs the SIWS message. Verifies the signature server-side, then
 * creates or updates the User + Profile and returns a `SiwsSession` that
 * the SDK stores locally.
 *
 * Flow (inside the SDK):
 *   1. modal calls siws.session() → null (no session yet)
 *   2. modal calls siws.nonce() → "abc123..."
 *   3. modal calls appkit.signIn({ statement, nonce }) → wallet signs
 *   4. modal calls siws.verify(signInResult, nonce, { address, network })
 *      → this endpoint
 *
 * Returns a SiwsSession: { network, address, expiry, metadata }
 * The SDK validates the returned session's address + network against the
 * connected wallet before accepting it.
 *
 * Body shape (sent by the SDK):
 *   {
 *     message: string,
 *     signedMessage: string,
 *     signerAddress: string,
 *     signedData?: string,
 *     issuedAt: string,
 *     expirationTime: string,
 *     nonce: string,
 *     context: { address: string, network: string }
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // SIWS verify does DB upsert + profile create — needs more time

// Session expiry: 7 days
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      signedMessage,
      signerAddress,
      signedData,
      issuedAt,
      expirationTime,
      nonce,
    } = body;

    if (!message || !signedMessage || !signerAddress || !nonce) {
      return NextResponse.json(
        { error: "Missing required SIWS fields" },
        { status: 400 }
      );
    }

    // Derive the expected domain from the request Origin/Host header.
    //
    // IMPORTANT: Do NOT strip the port! The SIWS message issued by the client
    // includes the full origin (e.g. "localhost:3000") as the domain. If we
    // strip the port (via .split(":")[0]), we get "localhost" which doesn't
    // match the message's domain → "Domain mismatch" error.
    //
    // RFC 6454 (Web Origin Concept) includes the port when it's non-default.
    // The SIWS spec follows the same convention — the domain field should
    // match the origin the user's browser shows.
    const origin = req.headers.get("origin") || req.headers.get("host") || "";
    const expectedDomain = origin
      .replace(/^https?:\/\//, "")
      .replace(/^\/+/, "")
      .split("/")[0];  // Keep the port! e.g. "localhost:3000"

    // Verify the SIWS signature using the official library
    const result = await verifySiws(
      { message, signedMessage, signerAddress, signedData },
      { expectedDomain, expectedNonce: nonce, debug: true }
    );

    if (!result.ok) {
      console.log("[SIWS] Verification failed:", result.reason);
      return NextResponse.json(
        { ok: false, error: "SIWS verification failed", reason: result.reason },
        { status: 401 }
      );
    }

    console.log("[SIWS] Verification passed for:", signerAddress.substring(0, 12));

    // Consume the nonce (one-time use)
    if (!consumeNonce(nonce)) {
      return NextResponse.json(
        { ok: false, error: "Nonce invalid, expired, or already consumed" },
        { status: 401 }
      );
    }

    // Upsert the User record
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
            isCustomUsername: true,
          },
        },
      },
    });

    // If the user has no profile, auto-generate one (username + isCustomUsername=false)
    // The user can change the username once via the profile modal.
    let profileData = user.profile;
    if (!user.profile) {
      const generatedUsername = await generateUniqueUsername(async (uname) => {
        const existing = await db.profile.findUnique({
          where: { username: uname },
        });
        return !!existing;
      });

      const newProfile = await db.profile.create({
        data: {
          userId: user.id,
          username: generatedUsername,
          isCustomUsername: false,
        },
      });

      profileData = {
        username: newProfile.username,
        displayName: newProfile.displayName,
        avatarUrl: newProfile.avatarUrl,
        bio: newProfile.bio,
        isCustomUsername: newProfile.isCustomUsername,
      };
    }

    // Audit log (best-effort)
    try {
      await db.auditLog.create({
        data: {
          projectId: null, // No project context for login/profile actions
          userId: user.id,
          action: "SHARE_GRANTED",
          targetType: "user",
          targetId: user.id,
          metadata: {
            action: "siws_login",
            signerAddress,
            issuedAt,
            expirationTime,
          },
        },
      });
    } catch {
      // best-effort
    }

    // Build the SiwsSession to return to the client
    const sessionExpiry = Date.now() + SESSION_TTL_MS;
    const siwsSession = {
      network: "TESTNET",
      address: signerAddress,
      expiry: sessionExpiry,
      metadata: {
        userId: user.id,
        username: profileData?.username,
        displayName: profileData?.displayName,
        avatarUrl: profileData?.avatarUrl,
        bio: profileData?.bio,
        isCustomUsername: profileData?.isCustomUsername ?? false,
        issuedAt: Date.now(),
      },
    };

    return NextResponse.json(siwsSession, { status: 200 });
  } catch (err) {
    console.error("[SIWS] Verify error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Verification failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
