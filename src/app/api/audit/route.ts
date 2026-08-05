import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §12 — Audit log API.
 *
 * Records edits, comments, deploys, and other mutations to the Postgres
 * audit_log table. Every mutation is logged with:
 *   - userId (who)
 *   - action (what)
 *   - targetType + targetId (on what)
 *   - filePath + lineRange (where, for file edits)
 *   - diffHash (what changed)
 *   - metadata (extra context)
 *   - timestamp (when)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const logs = await db.auditLog.findMany({
      where: { projectId },
      orderBy: { timestamp: "desc" },
      take: Math.min(limit, 200),
      include: { user: { select: { walletAddress: true, profile: { select: { username: true } } } } },
    });

    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch audit log", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      userId,
      action,
      targetType,
      targetId,
      filePath,
      lineRange,
      diffHash,
      metadata,
    } = body;

    if (!projectId || !action || !targetType) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, action, targetType" },
        { status: 400 }
      );
    }

    const log = await db.auditLog.create({
      data: {
        projectId,
        userId: userId || null,
        action,
        targetType,
        targetId: targetId || null,
        filePath: filePath || null,
        lineRange: lineRange || null,
        diffHash: diffHash || null,
        metadata: metadata || undefined,
      },
    });

    return NextResponse.json({ log }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create audit log entry", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
