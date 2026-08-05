import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * §6.5 — Comments persistence API.
 *
 * Syncs comments between the browser (IndexedDB) and Postgres.
 * The browser is the source of truth for optimistic UI; Postgres
 * is the persistent store that syncs to all collaborators.
 *
 * POST /api/comments — create or update a comment
 * GET /api/comments?projectId=X&filePath=Y — list comments for a file
 * DELETE /api/comments?id=X — delete (author-only, server-enforced)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const filePath = url.searchParams.get("filePath");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const where: Record<string, unknown> = { projectId };
    if (filePath) where.filePath = filePath;

    const comments = await db.comment.findMany({
      where,
      orderBy: { lineNumber: "asc" },
      include: {
        author: {
          select: {
            walletAddress: true,
            profile: { select: { username: true, avatarUrl: true } },
          },
        },
      },
    });

    return NextResponse.json({ comments });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch comments", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      filePath,
      fileId,
      lineNumber,
      lineSnapshot,
      authorId,
      body: commentBody,
      priority,
    } = body;

    if (!projectId || !filePath || !authorId || !commentBody) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Find or create the File record
    let file = null;
    if (fileId) {
      file = await db.file.findUnique({ where: { id: fileId } });
    }
    if (!file) {
      // Try to find by path
      file = await db.file.findFirst({
        where: { projectId, path: filePath },
      });
    }
    if (!file) {
      // Create the file record if it doesn't exist
      file = await db.file.create({
        data: {
          projectId,
          path: filePath,
          content: "",
          language: "rust",
          gitStatus: null,
        },
      });
    }

    const comment = await db.comment.create({
      data: {
        projectId,
        fileId: file.id,
        filePath,
        lineNumber: lineNumber ?? 1,
        lineSnapshot: lineSnapshot ?? "",
        authorId,
        body: commentBody,
        priority: priority ?? "NORMAL",
        status: "OPEN",
      },
    });

    // Record audit log
    await db.auditLog.create({
      data: {
        projectId,
        userId: authorId,
        action: "COMMENT_CREATED",
        targetType: "comment",
        targetId: comment.id,
        filePath,
        metadata: { lineNumber, priority },
      },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create comment", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, resolvedById, priority } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing comment id" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (status) {
      updateData.status = status;
      if (status === "RESOLVED") {
        updateData.resolvedAt = new Date();
        updateData.resolvedById = resolvedById ?? null;
      }
    }
    if (priority) updateData.priority = priority;

    const comment = await db.comment.update({
      where: { id },
      data: updateData,
    });

    // Record audit log
    await db.auditLog.create({
      data: {
        projectId: comment.projectId,
        userId: resolvedById ?? null,
        action: status === "RESOLVED" ? "COMMENT_RESOLVED" : "COMMENT_UPDATED",
        targetType: "comment",
        targetId: comment.id,
      },
    });

    return NextResponse.json({ comment });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update comment", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const requesterId = url.searchParams.get("requesterId");

    if (!id || !requesterId) {
      return NextResponse.json({ error: "Missing id or requesterId" }, { status: 400 });
    }

    const comment = await db.comment.findUnique({ where: { id } });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // §6.8 — Only the comment's author can delete (server-enforced)
    if (comment.authorId !== requesterId) {
      return NextResponse.json(
        { error: "Forbidden: only the author can delete this comment" },
        { status: 403 }
      );
    }

    await db.comment.update({
      where: { id },
      data: { status: "DELETED" },
    });

    await db.auditLog.create({
      data: {
        projectId: comment.projectId,
        userId: requesterId,
        action: "COMMENT_DELETED",
        targetType: "comment",
        targetId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete comment", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
