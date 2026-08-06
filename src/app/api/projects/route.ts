import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Projects API — list and create.
 *
 * GET /api/projects?ownerId=X
 *   Returns all projects where the user is the owner (or member).
 *
 * POST /api/projects
 *   Body: { name, description?, ownerId, files: [{path, content, language}] }
 *   Creates a new Project + File records in Postgres.
 *   Returns: { project }
 *
 * Local-first note: the client also stores projects in IndexedDB so the IDE
 * works without a login. When the user IS logged in, we mirror to Postgres
 * here so projects sync across devices.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free-tier storage quota: 1 GB per user.
 * Pro tier (TBD) will increase this. The quota is enforced server-side
 * by summing the length of all file `content` fields across all projects
 * the user owns.
 */
const FREE_TIER_QUOTA_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `proj-${Date.now().toString(36)}`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ownerId = url.searchParams.get("ownerId");

    if (!ownerId) {
      return NextResponse.json({ error: "Missing ownerId" }, { status: 400 });
    }

    // Projects where the user is the owner
    const ownedProjects = await db.project.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        ownerId: true,
        isPublic: true,
        defaultBranch: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { files: true } },
      },
    });

    // Projects where the user is a member (but not owner)
    const memberships = await db.projectMember.findMany({
      where: { userId: ownerId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            ownerId: true,
            isPublic: true,
            defaultBranch: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { files: true } },
          },
        },
      },
    });

    const memberProjects = memberships
      .map((m) => ({ ...m.project, role: m.role }))
      .filter((p) => p.ownerId !== ownerId);

    return NextResponse.json({
      projects: [...ownedProjects, ...memberProjects],
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch projects", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, ownerId, files } = body;

    if (!name || !ownerId) {
      return NextResponse.json(
        { error: "Missing required fields: name, ownerId" },
        { status: 400 }
      );
    }

    // Verify the user exists
    const user = await db.user.findUnique({ where: { id: ownerId } });
    if (!user) {
      return NextResponse.json(
        { error: "User not found — must be logged in to create a project" },
        { status: 401 }
      );
    }

    // §15 — Storage quota check (1 GB free tier).
    // Sum the byte length of all file contents across the user's existing
    // projects, then add the incoming project's size. If over quota, reject.
    const existingFiles = await db.file.findMany({
      where: {
        project: { ownerId },
        deletedAt: null,
      },
      select: { content: true },
    });
    const existingBytes = existingFiles.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0
    );
    const incomingBytes = Array.isArray(files)
      ? files.reduce(
          (sum: number, f: { content?: string }) =>
            sum + Buffer.byteLength(f.content ?? "", "utf8"),
          0
        )
      : 0;
    const totalBytes = existingBytes + incomingBytes;

    if (totalBytes > FREE_TIER_QUOTA_BYTES) {
      const usedMb = (existingBytes / (1024 * 1024)).toFixed(1);
      const quotaMb = (FREE_TIER_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
      const incomingMb = (incomingBytes / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        {
          error: "Storage quota exceeded",
          detail: `You're using ${usedMb} MB of ${quotaMb} MB. This project adds ${incomingMb} MB. Upgrade to Pro for more storage (coming soon).`,
          usage: {
            used: existingBytes,
            quota: FREE_TIER_QUOTA_BYTES,
            incoming: incomingBytes,
          },
        },
        { status: 413 }
      );
    }

    // Generate a unique slug
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (await db.project.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    // Create the project
    const project = await db.project.create({
      data: {
        name,
        slug,
        description: description || null,
        ownerId,
        defaultBranch: "main",
      },
    });

    // Add the owner as a ProjectMember with OWNER role
    await db.projectMember.create({
      data: {
        projectId: project.id,
        userId: ownerId,
        role: "OWNER",
      },
    });

    // Create file records (if provided)
    if (Array.isArray(files) && files.length > 0) {
      await db.file.createMany({
        data: files.map((f: { path: string; content: string; language: string }) => ({
          projectId: project.id,
          path: f.path,
          content: f.content,
          language: f.language,
          gitStatus: "untracked",
        })),
      });
    }

    // Audit log
    await db.auditLog.create({
      data: {
        projectId: project.id,
        userId: ownerId,
        action: "FILE_CREATED",
        targetType: "project",
        targetId: project.id,
        metadata: { action: "project_created", name, slug },
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create project", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
