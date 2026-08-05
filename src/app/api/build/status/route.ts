import { NextRequest, NextResponse } from "next/server";

/**
 * Build status — polled by the client to get build output lines.
 * Returns the current job state + all lines accumulated so far.
 * Client can pass ?since=<ts> to get only lines newer than that timestamp.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BuildLine {
  type: "stdout" | "stderr";
  text: string;
  ts: number;
}

interface BuildJob {
  id: string;
  status: "building" | "success" | "failed";
  lines: BuildLine[];
  wasmInfo?: { path: string; sizeBytes: number };
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const buildId = url.searchParams.get("id");
    const since = parseInt(url.searchParams.get("since") ?? "0", 10);

    if (!buildId) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const g = globalThis as unknown as { __buildJobs?: Map<string, BuildJob> };
    const jobs = g.__buildJobs;
    if (!jobs) {
      return NextResponse.json({ error: "No builds have been started" }, { status: 404 });
    }

    const job = jobs.get(buildId);
    if (!job) {
      return NextResponse.json({ error: "Build not found" }, { status: 404 });
    }

    const lines = since > 0 ? job.lines.filter((l) => l.ts > since) : job.lines;

    return NextResponse.json({
      id: job.id,
      status: job.status,
      lines,
      wasmInfo: job.wasmInfo,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lineCount: job.lines.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Status check failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
