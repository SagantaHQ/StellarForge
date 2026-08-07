import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/share/list?projectId=X
 *
 * Lists all active share permissions for a project. Used by the host
 * to see who has access and manage permissions.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const permissions = await db.sharePermission.findMany({
      where: {
        projectId,
        isActive: true,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
      include: {
        sharedTo: {
          select: {
            profile: { select: { username: true, avatarUrl: true } },
          },
        },
      },
    });

    return NextResponse.json({
      shares: permissions.map((p) => ({
        id: p.id,
        shareType: p.shareType,
        shareToken: p.shareToken,
        guestUsername: p.guestUsername,
        role: p.role,
        sharedToUsername: p.sharedTo?.profile?.username ?? p.guestUsername,
        sharedToAvatar: p.sharedTo?.profile?.avatarUrl ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list shares", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
