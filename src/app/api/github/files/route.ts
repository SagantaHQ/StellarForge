import { NextRequest, NextResponse } from "next/server";
import { resolveGithubToken } from "@/lib/github/token";

/**
 * GET /api/github/files?walletAddress=GXXX&owner=X&repo=X&branch=X
 *
 * Fetches all text files from a GitHub repo's branch using the Git Trees
 * API (recursive) + Blobs API. Returns an array of { path, content, language }.
 *
 * Used by the GitPanel's auto-import flow: when a user clicks "Commit to
 * GitHub" but their project isn't linked to a repo yet, we fetch the repo's
 * files so we can either:
 *   - Show a conflict warning (if the repo has files that differ from local)
 *   - Auto-merge (if the repo is empty or the user confirms overwrite)
 *
 * This is lighter than /api/projects/import-git (which does a full git clone)
 * because it uses the GitHub REST API directly — no temp directory, no git
 * binary, no filesystem operations.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_API = "https://api.github.com";

const TEXT_EXTENSIONS = new Set([
  "rs", "toml", "ts", "tsx", "js", "jsx", "json", "md", "txt", "yaml", "yml",
  "gitignore", "env", "sh", "py", "go", "sql", "lock", "dockerfile", "makefile",
]);

function detectLanguage(ext: string): string {
  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "toml": return "toml";
    case "md": return "markdown";
    default: return "plaintext";
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");
    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const branch = url.searchParams.get("branch") || "main";

    if (!walletAddress || !owner || !repo) {
      return NextResponse.json(
        { error: "Missing required params: walletAddress, owner, repo" },
        { status: 400 }
      );
    }

    const tokenResult = await resolveGithubToken(walletAddress);
    if (!tokenResult) {
      return NextResponse.json(
        { error: "GitHub not connected", needsConnect: true },
        { status: 401 }
      );
    }

    const { token } = tokenResult;

    // Step 1: Get the branch HEAD
    const refRes = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Soroban.Build",
        },
      }
    );

    if (!refRes.ok) {
      if (refRes.status === 404) {
        return NextResponse.json(
          { error: `Branch '${branch}' not found`, needsImport: true },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch branch: ${refRes.status}` },
        { status: 502 }
      );
    }

    const refData = await refRes.json();
    const headSha = refData.object.sha;

    // Step 2: Get the tree (recursive)
    const treeRes = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${headSha}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Soroban.Build",
        },
      }
    );

    if (!treeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch tree: ${treeRes.status}` },
        { status: 502 }
      );
    }

    const treeData = await treeRes.json();

    // Step 3: Fetch each file's content (filter to text files only)
    const files: { path: string; content: string; language: string }[] = [];
    const blobs = (treeData.tree || []).filter((e: { type: string }) => e.type === "blob");

    for (const entry of blobs) {
      if (files.length >= 500) break;

      const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTENSIONS.has(ext) && !TEXT_EXTENSIONS.has(entry.path.toLowerCase())) continue;

      try {
        // Fetch the blob
        const blobRes = await fetch(entry.url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "Soroban.Build",
          },
        });

        if (!blobRes.ok) continue;
        const blob = await blobRes.json();

        // Decode base64 content
        const content = Buffer.from(blob.content, blob.encoding || "base64").toString("utf8");

        files.push({
          path: entry.path,
          content,
          language: detectLanguage(ext),
        });
      } catch {
        // Skip files that can't be decoded
        continue;
      }
    }

    return NextResponse.json({
      files,
      branch,
      headSha,
      fileCount: files.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch repo files", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
