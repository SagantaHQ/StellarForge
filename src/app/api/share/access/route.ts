import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/share/access?token=X
 * GET /api/share/access?projectId=X&username=Y
 *
 * Verifies share access — used when a guest opens a shared link or
 * when checking if a user was invited to a project.
 *
 * Returns:
 *   {
 *     hasAccess: boolean,
 *     role: "VIEWER" | "EDITOR",
 *     projectId: string,
 *     projectName: string,
 *     ownerUsername: string,
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const projectId = url.searchParams.get("projectId");
    const username = url.searchParams.get("username");

    let permission: {
      role: string;
      shareType: string;
      project: {
        id: string;
        name: string;
        ownerId: string;
        owner: { profile: { username: string } | null } | null;
      };
    } | null = null;

    if (token) {
      // Public link access
      permission = await db.sharePermission.findFirst({
        where: {
          shareToken: token,
          isActive: true,
          revokedAt: null,
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              owner: {
                select: {
                  profile: { select: { username: true } },
                },
              },
            },
          },
        },
      });
    } else if (projectId && username) {
      // Private user access
      permission = await db.sharePermission.findFirst({
        where: {
          projectId,
          guestUsername: username.toLowerCase(),
          isActive: true,
          revokedAt: null,
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              owner: {
                select: {
                  profile: { select: { username: true } },
                },
              },
            },
          },
        },
      });
    }

    if (!permission) {
      return NextResponse.json({ hasAccess: false });
    }

    return NextResponse.json({
      hasAccess: true,
      role: permission.role,
      projectId: permission.project.id,
      projectName: permission.project.name,
      ownerUsername: permission.project.owner?.profile?.username ?? "unknown",
      shareType: permission.shareType,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to check access", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
