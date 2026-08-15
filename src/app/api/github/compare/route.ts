import { NextRequest, NextResponse } from "next/server";
import { resolveGithubToken } from "@/lib/github/token";

/**
 * POST /api/github/compare
 *
 * Compares the local project files against the current state of a GitHub
 * repo's branch. Returns a diff summary so the client can show:
 *   - Files that exist locally but not on GitHub (new files to push)
 *   - Files that exist on GitHub but not locally (deleted locally)
 *   - Files that exist in both but have different content (modified)
 *   - Files that are identical (no change)
 *
 * This is used by the GitPanel to:
 *   1. Detect conflicts before committing
 *   2. Show the user what will be committed
 *   3. Decide whether to auto-import the repo first (if the project isn't
 *      linked to a GitHub repo yet)
 *
 * Body:
 *   {
 *     walletAddress: string,
 *     owner: string,
 *     repo: string,
 *     branch: string,
 *     localFiles: [{ path: string, content: string }]
 *   }
 *
 * Returns:
 *   {
 *     hasConflicts: boolean,
 *     summary: { added, modified, deleted, unchanged },
 *     files: {
 *       added: [path],
 *       modified: [{ path, localHash, remoteHash }],
 *       deleted: [path],
 *       unchanged: [path]
 *     },
 *     remoteFileCount: number,
 *     localFileCount: number
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_API = "https://api.github.com";

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

interface GitHubTree {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

interface GitHubBlob {
  sha: string;
  content: string;
  encoding: string;
}

async function githubFetch(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "StellarForge",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

/** Fetch a file's content from GitHub as a UTF-8 string. */
async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const res = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
      token
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding === "base64") {
      // Decode base64 → UTF-8
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return data.content ?? null;
  } catch {
    return null;
  }
}

/** Simple hash for content comparison (avoids storing full content in the response). */
function hashContent(content: string): string {
  // Use a simple FNV-1a hash — fast and sufficient for equality comparison
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, owner, repo, branch, localFiles } = body;

    if (!walletAddress || !owner || !repo || !branch || !Array.isArray(localFiles)) {
      return NextResponse.json(
        { error: "Missing required fields: walletAddress, owner, repo, branch, localFiles" },
        { status: 400 }
      );
    }

    // Resolve the GitHub token (user OAuth or server PAT)
    const tokenResult = await resolveGithubToken(walletAddress);
    if (!tokenResult) {
      return NextResponse.json(
        {
          error: "GitHub not connected",
          detail: "Connect your GitHub account to compare files.",
          needsConnect: true,
        },
        { status: 401 }
      );
    }

    const { token } = tokenResult;

    // Step 1: Get the branch's HEAD commit SHA
    const refRes = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );

    if (!refRes.ok) {
      if (refRes.status === 404) {
        return NextResponse.json(
          {
            error: `Branch '${branch}' not found in ${owner}/${repo}`,
            needsImport: true,
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch branch ref: ${refRes.status}` },
        { status: 502 }
      );
    }

    const refData = await refRes.json();
    const headSha = refData.object.sha;

    // Step 2: Get the tree (recursive) for the HEAD commit
    const treeRes = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${headSha}?recursive=1`,
      token
    );

    if (!treeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch repo tree: ${treeRes.status}` },
        { status: 502 }
      );
    }

    const tree: GitHubTree = await treeRes.json();

    // Build a map of remote files (path → tree entry). Only include blobs (files), not trees (dirs).
    const remoteFiles = new Map<string, GitHubTreeEntry>();
    for (const entry of tree.tree) {
      if (entry.type === "blob") {
        remoteFiles.set(entry.path, entry);
      }
    }

    // Build a map of local files (path → content hash)
    const localFilesMap = new Map<string, string>();
    for (const f of localFiles as { path: string; content: string }[]) {
      localFilesMap.set(f.path, hashContent(f.content));
    }

    // Step 3: Compare
    const added: string[] = []; // local only
    const deleted: string[] = []; // remote only
    const modified: { path: string; localHash: string; remoteSha: string }[] = [];
    const unchanged: string[] = [];

    // Check local files against remote
    for (const [path, localHash] of localFilesMap) {
      const remoteEntry = remoteFiles.get(path);
      if (!remoteEntry) {
        // File exists locally but not on GitHub → added
        added.push(path);
      } else {
        // File exists in both — need to fetch remote content to compare
        // (we can't compare by SHA because local content isn't git-hashed)
        const remoteContent = await fetchFileContent(token, owner, repo, path, branch);
        if (remoteContent === null) {
          // Couldn't fetch — treat as modified to be safe
          modified.push({ path, localHash, remoteSha: remoteEntry.sha });
        } else {
          const remoteHash = hashContent(remoteContent);
          if (localHash === remoteHash) {
            unchanged.push(path);
          } else {
            modified.push({ path, localHash, remoteSha: remoteEntry.sha });
          }
        }
      }
    }

    // Check remote files not in local → deleted
    for (const [path] of remoteFiles) {
      if (!localFilesMap.has(path)) {
        deleted.push(path);
      }
    }

    const hasConflicts = modified.length > 0;
    const hasChanges = added.length > 0 || modified.length > 0 || deleted.length > 0;

    return NextResponse.json({
      hasConflicts,
      hasChanges,
      summary: {
        added: added.length,
        modified: modified.length,
        deleted: deleted.length,
        unchanged: unchanged.length,
      },
      files: {
        added,
        modified: modified.map((m) => ({ path: m.path })),
        deleted,
        unchanged,
      },
      remoteFileCount: remoteFiles.size,
      localFileCount: localFilesMap.size,
      branch,
      headSha,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to compare files", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
