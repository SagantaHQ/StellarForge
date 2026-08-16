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

    // Parse test results from the output lines (for cargo test runs)
    // Look for lines like: "test test_fn_name ... ok" or "test test_fn_name ... FAILED"
    let testResults: { name: string; passed: boolean; message?: string }[] | undefined;
    if (job.status === "success" || job.status === "failed") {
      testResults = [];
      for (const line of job.lines) {
        // Match: "test <name> ... ok"
        const okMatch = line.text.match(/^test\s+(\S+)\s+\.\.\.\s+ok$/);
        if (okMatch) {
          testResults.push({ name: okMatch[1], passed: true });
          continue;
        }
        // Match: "test <name> ... FAILED"
        const failMatch = line.text.match(/^test\s+(\S+)\s+\.\.\.\s+FAILED$/);
        if (failMatch) {
          testResults.push({ name: failMatch[1], passed: false });
          continue;
        }
        // Match: "test <name> ... ignored"
        const ignMatch = line.text.match(/^test\s+(\S+)\s+\.\.\.\s+ignored$/);
        if (ignMatch) {
          testResults.push({ name: ignMatch[1], passed: true, message: "ignored" });
          continue;
        }
      }
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      lines,
      wasmInfo: job.wasmInfo,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lineCount: job.lines.length,
      // Include testResults only if we found any (cargo test output)
      ...(testResults && testResults.length > 0 ? { testResults } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Status check failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
