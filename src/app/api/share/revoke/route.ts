import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/share/revoke
 *
 * Revokes a share permission (deactivates it). Only the project owner
 * can revoke shares.
 *
 * Body:
 *   { shareId: string, ownerId: string }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shareId, ownerId } = body;

    if (!shareId || !ownerId) {
      return NextResponse.json({ error: "Missing shareId or ownerId" }, { status: 400 });
    }

    const permission = await db.sharePermission.findUnique({
      where: { id: shareId },
      include: { project: { select: { ownerId: true } } },
    });

    if (!permission) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    if (permission.project.ownerId !== ownerId) {
      return NextResponse.json({ error: "Only the project owner can revoke shares" }, { status: 403 });
    }

    await db.sharePermission.update({
      where: { id: shareId },
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        projectId: permission.projectId,
        userId: ownerId,
        action: "SHARE_REVOKED",
        targetType: "share",
        targetId: shareId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to revoke share", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
