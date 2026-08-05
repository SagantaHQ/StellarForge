import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

/**
 * §9.4 — Knowledge base update API.
 *
 * Re-pulls all knowledge repos and rebuilds the agent system prompt.
 * Called by the "Update knowledge base" button in Settings.
 */

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    // Run the setup-knowledge.sh script to re-pull repos
    const { stdout, stderr } = await execAsync(
      "bash scripts/setup-knowledge.sh ./knowledge",
      {
        cwd: process.cwd(),
        timeout: 240_000, // 4 min
      }
    );

    return NextResponse.json({
      success: true,
      updatedAt: new Date().toISOString(),
      output: stdout.slice(-500), // last 500 chars of output
      errors: stderr || null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update knowledge base",
        detail: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
