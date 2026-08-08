import { NextResponse } from "next/server";

/**
 * SIWS Nonce endpoint.
 *
 * Issues a cryptographically random nonce that the client includes in the
 * Sign-In With Stellar message. The nonce is stored in a server-side
 * in-memory Map (keyed by nonce) with a 10-minute TTL so verify can
 * check it was issued by us and not yet consumed.
 *
 * The stellar-appkit client calls this via the `siws.nonce` callback:
 *
 *   nonce: async () => (await fetch('/api/siws/nonce')).text()
 *
 * NOTE: returns plain text (not JSON) because the SDK expects `string`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NonceRecord {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
}

// In-memory nonce store. Persists across HMR via globalThis.
// In production with multiple server instances, swap this for a Redis-backed
// store or a Postgres nonce table.
const g = globalThis as unknown as { __siwsNonces?: Map<string, NonceRecord> };
if (!g.__siwsNonces) g.__siwsNonces = new Map();
const nonces = g.__siwsNonces;

// Clean up expired nonces every 5 minutes
const gCleanup = globalThis as unknown as { __siwsCleanupTimer?: NodeJS.Timeout };
if (!gCleanup.__siwsCleanupTimer) {
  gCleanup.__siwsCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of nonces) {
      if (rec.expiresAt < now) nonces.delete(key);
    }
  }, 5 * 60 * 1000);
  // Don't keep the process alive just for this timer
  if (gCleanup.__siwsCleanupTimer.unref) gCleanup.__siwsCleanupTimer.unref();
}

export async function GET() {
  try {
    // Generate 32 bytes of randomness, hex-encoded
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes

    nonces.set(nonce, { nonce, issuedAt: now, expiresAt, consumed: false });

    // Return plain text — the SDK expects `string`, not JSON
    return new NextResponse(nonce, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to generate nonce", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * Consume a nonce — called by /api/siws/verify after successful verification.
 * Returns true if the nonce was valid + unconsumed, false otherwise.
 * Exported for use by the verify route.
 */
export function consumeNonce(nonce: string): boolean {
  const rec = nonces.get(nonce);
  if (!rec) return false;
  if (rec.consumed) return false;
  if (rec.expiresAt < Date.now()) {
    nonces.delete(nonce);
    return false;
  }
  rec.consumed = true;
  // Delete after a short delay so concurrent retries don't fail
  setTimeout(() => nonces.delete(nonce), 60_000);
  return true;
}
