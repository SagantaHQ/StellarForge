import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * SIWS Logout endpoint.
 *
 * Called by the stellar-appkit client's `siws.signout` callback when the
 * user disconnects their wallet (with signoutOnDisconnect=true, the default).
 * Clears the server-side session by bumping lastSeenAt to null.
 *
 * Body: { address?: string }
 *   - address is optional — if omitted, just returns success
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const address = body.address;

    if (address) {
      // Best-effort: clear lastSeenAt so the next session check fails
      // and the SDK triggers a fresh sign-in.
      await db.user.update({
        where: { walletAddress: address },
        data: { lastSeenAt: null },
      }).catch(() => {
        // User may not exist — ignore
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[SIWS] Logout error:", err);
    // Always return success — signout is best-effort
    return NextResponse.json({ ok: true });
  }
}
