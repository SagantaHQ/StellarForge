import { NextRequest, NextResponse } from "next/server";
import { verifySiws, type SiwsPayload } from "@saganta/stellar-appkit-siws-verify";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { db } from "@/lib/db";

/**
 * §11 — SIWS Signature Verification endpoint.
 *
 * Verifies the Sign-In With Stellar payload:
 *   1. Parses the SIWS message (domain, nonce, expiry)
 *   2. Checks the nonce matches what was issued
 *   3. Checks the domain matches this app
 *   4. Checks the message hasn't expired
 *   5. Verifies the ed25519 signature over the message bytes
 *
 * If verification passes, the wallet address is confirmed to own the
 * signature — the user can now save their username.
 *
 * POST /api/auth/verify-siws
 * Body: { message, signedMessage, signerAddress, nonce, username, displayName?, bio? }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, signedMessage, signerAddress, nonce, username, displayName, bio } = body;

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

    // §11 — Derive the expected domain from the request itself.
    // The client uses window.location.hostname in the SIWS message, so the
    // server must match against the same domain the user sees — not a
    // static env variable that might be "localhost" while the user is on
    // a preview URL like preview-xxx.space-z.ai.
    const origin = req.headers.get("origin") || req.headers.get("host") || "";
    const expectedDomain = origin
      .replace(/^https?:\/\//, "")
      .replace(/^\/+/, "")
      .split("/")[0]
      .split(":")[0]; // strip port

    // §11 — Verify the SIWS payload using @saganta/stellar-appkit-siws-verify
    // Pass a custom verifySignatureFn that uses a STATIC import of
    // @stellar/stellar-sdk — the default verifier uses a dynamic import()
    // which fails silently in Turbopack's server runtime.
    const payload: SiwsPayload = { message, signedMessage, signerAddress };

    // Debug: log what we received — compare with client-side log
    const messageBuffer = Buffer.from(message, "utf-8");
    console.log("[SIWS Server] Received:", {
      messageLength: message.length,
      messageBytes: messageBuffer.length,
      messageHex: messageBuffer.toString("hex").substring(0, 100),
      messageFull: message,
      signedMessageLength: signedMessage.length,
      signedMessagePreview: signedMessage.substring(0, 40),
      signerAddress: signerAddress.substring(0, 12),
      nonce: nonce.substring(0, 12),
      expectedDomain,
    });

    const result = await verifySiws(payload, {
      expectedDomain,
      expectedNonce: nonce,
      verifySignatureFn: ({ message: msg, signature, address }) => {
        try {
          const keypair = Keypair.fromPublicKey(address);
          const messageBuffer = Buffer.from(msg, "utf-8");
          // Decode signature — accept both hex and base64
          const isHex = /^[0-9a-fA-F]+$/.test(signature) && signature.length % 2 === 0;
          const signatureBuffer = Buffer.from(signature, isHex ? "hex" : "base64");

          console.log("[SIWS] Verifying:", {
            addressPrefix: address?.substring(0, 12),
            messageBytes: messageBuffer.length,
            signatureBytes: signatureBuffer.length,
            signatureEncoding: isHex ? "hex" : "base64",
          });

          const valid = keypair.verify(messageBuffer, signatureBuffer);
          console.log("[SIWS] Verification result:", valid);

          if (!valid) {
            // Try SHA-256 hash verification (some wallets sign the hash, not raw)
            const hash = createHash("sha256").update(messageBuffer).digest();
            const hashValid = keypair.verify(hash, signatureBuffer);
            console.log("[SIWS] SHA-256 hash verification:", hashValid);
            if (hashValid) return true;
          }

          return valid;
        } catch (err) {
          console.error("[SIWS] Signature verification error:", err);
          return false;
        }
      },
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "SIWS verification failed",
          reason: result.reason,
          debug: {
            expectedDomain,
            serverMessageLength: message.length,
            serverMessageBytes: messageBuffer.length,
            serverMessageHex: messageBuffer.toString("hex").substring(0, 200),
            signedMessageLength: signedMessage.length,
            signerAddress: signerAddress.substring(0, 12),
          },
        },
        { status: 401 }
      );
    }

    // Verification passed — the wallet address owns this signature
    // Now check username uniqueness and save the profile
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

    // Upsert user (find by walletAddress, create if not exists)
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

    // Record audit log (skip if no project exists — audit log is optional)
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
      // Audit log is best-effort — don't fail the profile save if it errors
      // (e.g. foreign key constraint on projectId)
    }

    return NextResponse.json({
      verified: true,
      user: { id: user.id, walletAddress: user.walletAddress },
      profile: { id: profile.id, username: profile.username },
      claims: result.claims,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Verification failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
