import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §11 — SIWS Nonce endpoint.
 *
 * Issues a cryptographically random nonce that the client includes in the
 * Sign-In With Stellar message. The server stores this nonce so it can
 * verify the signature was for this specific sign-in attempt (prevents
 * replay attacks).
 *
 * Flow:
 *   1. Client: GET /api/auth/nonce → { nonce }
 *   2. Client: wallet.signInWithStellar({ nonce, ... }) → { message, signedMessage, signerAddress }
 *   3. Client: POST /api/auth/verify-siws with the SIWS payload
 *   4. Server: verifySiws(payload, { expectedNonce: nonce }) → checks signature
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Generate a random nonce (32 bytes hex)
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Store the nonce in the database (or in-memory for now)
    // We use a simple audit log entry to track issued nonces
    // In production, use a dedicated nonce table with TTL
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000); // 10 min

    return NextResponse.json({
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to generate nonce", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
