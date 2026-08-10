import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Project by ID — get single project (with files) or delete.
 *
 * GET /api/projects/[id]
 *   Returns: { project, files: [{path, content, language, gitStatus}] }
 *
 * DELETE /api/projects/[id]?requesterId=X
 *   Cascades to: files, comments, members, snapshots, audit logs, etc.
 *   Only the project owner can delete (server-enforced).
 *
 * PATCH /api/projects/[id]
 *   Body: { name?, description?, files?: [{path, content, language}] }
 *   Updates project metadata and/or replaces files.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      include: {
        files: {
          where: { deletedAt: null },
          select: {
            path: true,
            content: true,
            language: true,
            gitStatus: true,
          },
        },
        owner: {
          select: {
            id: true,
            walletAddress: true,
            profile: { select: { username: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch project", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const requesterId = url.searchParams.get("requesterId");

    if (!requesterId) {
      return NextResponse.json({ error: "Missing requesterId" }, { status: 400 });
    }

    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, ownerId: true, name: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Only the owner can delete the project (server-enforced)
    if (project.ownerId !== requesterId) {
      return NextResponse.json(
        { error: "Forbidden: only the project owner can delete this project" },
        { status: 403 }
      );
    }

    // Cascade delete — Prisma onDelete: Cascade handles files, comments,
    // members, snapshots, audit logs, share permissions, collab sessions.
    await db.project.delete({ where: { id } });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to delete project", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, description, files, requesterId } = body;

    if (!requesterId) {
      return NextResponse.json({ error: "Missing requesterId" }, { status: 400 });
    }

    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.ownerId !== requesterId) {
      return NextResponse.json(
        { error: "Forbidden: only the project owner can modify this project" },
        { status: 403 }
      );
    }

    // Update project metadata
    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (Object.keys(updateData).length > 0) {
      await db.project.update({ where: { id }, data: updateData });
    }

    // Replace files if provided
    if (Array.isArray(files)) {
      // Hard-delete ALL existing files for this project (avoids unique
      // constraint violation on (projectId, path) when re-creating)
      await db.file.deleteMany({
        where: { projectId: id },
      });
      // Create new files
      if (files.length > 0) {
        await db.file.createMany({
          data: files.map((f: { path: string; content: string; language: string }) => ({
            projectId: id,
            path: f.path,
            content: f.content,
            language: f.language ?? "plaintext",
            gitStatus: null,
          })),
        });
      }
    }

    const updated = await db.project.findUnique({ where: { id } });
    return NextResponse.json({ project: updated });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update project", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
