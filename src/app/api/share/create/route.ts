import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

/**
 * POST /api/share/create
 *
 * Creates a share permission for a project.
 *
 * Two modes:
 *   1. Public link — generates a unique token, anyone with the URL can join
 *   2. Private user — invites a specific user by username
 *
 * Roles:
 *   - VIEWER: read-only (can view files + add comments, cannot edit)
 *   - EDITOR: full edit access (can edit files + add comments)
 *
 * Body:
 *   {
 *     projectId: string,       // server project ID
 *     ownerId: string,         // host's user ID (for auth check)
 *     mode: "public" | "private",
 *     role: "VIEWER" | "EDITOR",
 *     guestUsername?: string,  // required for private mode
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, mode, role, guestUsername, walletAddress } = body;

    if (!projectId || !mode || !role) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, mode, role" },
        { status: 400 }
      );
    }

    // SECURITY: Derive ownerId from the wallet address (not client-supplied)
    // The client sends walletAddress; we look up the server user ID.
    // This prevents privilege escalation (client sending another user's ownerId).
    if (!walletAddress) {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { walletAddress },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const ownerId = user.id;

    if (mode !== "public" && mode !== "private") {
      return NextResponse.json({ error: "Invalid mode. Use 'public' or 'private'." }, { status: 400 });
    }

    if (role !== "VIEWER" && role !== "EDITOR") {
      return NextResponse.json({ error: "Invalid role. Use 'VIEWER' or 'EDITOR'." }, { status: 400 });
    }

    if (mode === "private" && !guestUsername) {
      return NextResponse.json({ error: "guestUsername is required for private shares" }, { status: 400 });
    }

    // Verify the requester is the project owner
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, name: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.ownerId !== ownerId) {
      return NextResponse.json({ error: "Only the project owner can share" }, { status: 403 });
    }

    let shareToken: string | null = null;
    let sharedToId: string | null = null;
    let resolvedGuestUsername: string | null = null;

    if (mode === "public") {
      // Generate a unique share token
      shareToken = randomBytes(16).toString("hex");
    } else {
      // Private — find the user by username
      const guestUser = await db.user.findFirst({
        where: {
          profile: {
            username: guestUsername.toLowerCase(),
          },
        },
        select: { id: true, profile: { select: { username: true } } },
      });

      if (!guestUser) {
        return NextResponse.json(
          { error: `User '${guestUsername}' not found. They must have a Soroban.Build account.` },
          { status: 404 }
        );
      }

      sharedToId = guestUser.id;
      resolvedGuestUsername = guestUser.profile?.username ?? guestUsername;

      // Check if a share already exists for this user + project
      const existing = await db.sharePermission.findFirst({
        where: {
          projectId,
          sharedToId,
          isActive: true,
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: `Already shared with ${resolvedGuestUsername}` },
          { status: 409 }
        );
      }
    }

    // Create the share permission
    const permission = await db.sharePermission.create({
      data: {
        projectId,
        shareType: mode === "public" ? "PUBLIC_LINK" : "PRIVATE_USER",
        shareToken,
        sharedToId,
        guestUsername: resolvedGuestUsername,
        role,
        isActive: true,
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        projectId,
        userId: ownerId,
        action: "SHARE_GRANTED",
        targetType: "share",
        targetId: permission.id,
        metadata: {
          mode,
          role,
          guestUsername: resolvedGuestUsername,
          hasToken: !!shareToken,
        },
      },
    });

    return NextResponse.json({
      id: permission.id,
      mode,
      role,
      shareToken,
      guestUsername: resolvedGuestUsername,
      shareUrl: shareToken
        ? `${process.env.NEXT_PUBLIC_APP_URL || ""}/shared/${shareToken}`
        : null,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create share", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
