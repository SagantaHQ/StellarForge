import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §11 — Profile save API.
 *
 * Creates or updates a User + Profile in Postgres after wallet connect.
 * Called by the profile modal when the user completes their profile.
 *
 * POST /api/profile
 * Body: { walletAddress, username, displayName?, avatarUrl?, bio? }
 * Returns: { user, profile }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, username, displayName, avatarUrl, bio } = body;

    if (!walletAddress || !username) {
      return NextResponse.json(
        { error: "Missing walletAddress or username" },
        { status: 400 }
      );
    }

    // Upsert user (find by walletAddress, create if not exists)
    const user = await db.user.upsert({
      where: { walletAddress },
      update: { lastSeenAt: new Date() },
      create: {
        walletAddress,
        email: null,
        lastSeenAt: new Date(),
      },
    });

    // Check username uniqueness (server-enforced) — only if this username
    // belongs to a DIFFERENT user
    const existingProfile = await db.profile.findFirst({
      where: {
        username: username.toLowerCase(),
        userId: { not: user.id },
      },
    });
    if (existingProfile) {
      return NextResponse.json(
        { error: "Username already taken", field: "username" },
        { status: 409 }
      );
    }

    // Get the current profile to check if the username is changing
    const currentProfile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { username: true, isCustomUsername: true },
    });

    // If the username is different from the current one, mark it as custom
    // (locked). Once the user sets a custom username, it can't be changed again.
    const usernameChanged = currentProfile && currentProfile.username !== username.toLowerCase();
    const alreadyCustom = currentProfile?.isCustomUsername ?? false;

    // Reject username change if already custom (locked) — enforced at server level
    if (alreadyCustom && usernameChanged) {
      return NextResponse.json(
        { error: "Username is locked and cannot be changed after being set", field: "username" },
        { status: 403 }
      );
    }

    // If the username hasn't changed but is already custom, don't update it
    // (prevents accidental overwrites)
    const updateData: Record<string, unknown> = {
      displayName: displayName || null,
      avatarUrl: avatarUrl || null,
      bio: bio || null,
    };
    if (usernameChanged) {
      updateData.username = username.toLowerCase();
      updateData.isCustomUsername = true;
    }

    // Upsert profile (create if doesn't exist, update if it does)
    const profile = await db.profile.upsert({
      where: { userId: user.id },
      update: updateData,
      create: {
        userId: user.id,
        username: username.toLowerCase(),
        displayName: displayName || null,
        avatarUrl: avatarUrl || null,
        bio: bio || null,
        isCustomUsername: true, // user explicitly set this username
      },
    });

    // Record audit log (best-effort — don't fail if it errors)
    try {
      await db.auditLog.create({
        data: {
          projectId: "default",
          userId: user.id,
          action: "SHARE_GRANTED",
          targetType: "user",
          targetId: user.id,
          metadata: { username, action: "profile_created" },
        },
      }).catch(() => {});
    } catch {
      // Audit log is best-effort — don't fail the profile save
    }

    return NextResponse.json({ user, profile }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save profile", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** GET — fetch a user's profile by wallet address */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { walletAddress },
      include: { profile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user, profile: user.profile });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch profile", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
