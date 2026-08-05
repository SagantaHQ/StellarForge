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

    // Check username uniqueness (server-enforced)
    const existing = await db.profile.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Username already taken", field: "username" },
        { status: 409 }
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

    // Create profile
    const profile = await db.profile.create({
      data: {
        userId: user.id,
        username: username.toLowerCase(),
        displayName: displayName || null,
        avatarUrl: avatarUrl || null,
        bio: bio || null,
      },
    });

    // Record audit log
    await db.auditLog.create({
      data: {
        projectId: "default",
        userId: user.id,
        action: "SHARE_GRANTED", // closest action for profile creation
        targetType: "user",
        targetId: user.id,
        metadata: { username, action: "profile_created" },
      },
    });

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
