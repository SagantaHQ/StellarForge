import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/github/commit
 *
 * Commits one or more files to a GitHub repo using the Git Data API.
 * This creates a single commit with all file changes (not one commit per file).
 *
 * Flow (GitHub Git Data API):
 *   1. GET /repos/{owner}/{repo}/git/ref/heads/{branch} → get current HEAD SHA
 *   2. GET /repos/{owner}/{repo}/git/commits/{sha} → get current tree SHA
 *   3. POST /repos/{owner}/{repo}/git/trees → create a new tree with file changes
 *      (base_tree = current tree SHA, tree = [{path, content, mode: "100644", type: "blob"}])
 *   4. POST /repos/{owner}/{repo}/git/commits → create a commit pointing to the new tree
 *      (parents = [current HEAD SHA], tree = new tree SHA, message = commit message)
 *   5. PATCH /repos/{owner}/{repo}/git/refs/heads/{branch} → update the branch ref
 *      to point to the new commit SHA
 *
 * Body:
 *   {
 *     walletAddress: string,
 *     owner: string,        // repo owner (e.g. "octocat")
 *     repo: string,         // repo name (e.g. "my-contract")
 *     branch: string,       // branch name (e.g. "main")
 *     message: string,      // commit message
 *     files: [{ path: string, content: string }],
 *     createBranch?: boolean, // if true and branch doesn't exist, create it from default branch
 *   }
 *
 * Returns:
 *   { commitSha: string, commitUrl: string, branch: string }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GITHUB_API = "https://api.github.com";

interface CommitFile {
  path: string;
  content: string;
}

interface GitRef {
  ref: string;
  node_id: string;
  url: string;
  object: { sha: string; type: string; url: string };
}

interface GitCommit {
  sha: string;
  node_id: string;
  url: string;
  html_url: string;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
  tree: { sha: string; url: string };
  parents: { sha: string; url: string }[];
  message: string;
}

interface GitTree {
  sha: string;
  url: string;
  tree: {
    path: string;
    mode: string;
    type: string;
    sha: string | null;
    size: number | null;
    url: string;
  }[];
}

async function githubFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Soroban.Build",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      walletAddress,
      owner,
      repo,
      branch: requestedBranch,
      message,
      files,
      createBranch,
    } = body;

    if (!walletAddress || !owner || !repo || !message || !Array.isArray(files)) {
      return NextResponse.json(
        { error: "Missing required fields: walletAddress, owner, repo, message, files" },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files to commit" },
        { status: 400 }
      );
    }

    // Find the user and their GitHub token
    const user = await db.user.findUnique({
      where: { walletAddress },
      select: { id: true, githubAccessToken: true, githubUsername: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.githubAccessToken) {
      return NextResponse.json(
        {
          error: "GitHub not connected",
          detail: "Connect your GitHub account to commit changes.",
          needsConnect: true,
        },
        { status: 401 }
      );
    }

    const token = user.githubAccessToken;
    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const branch = requestedBranch || "main";

    // Step 0: Get repo info (to find default branch if we need to create a branch)
    let defaultBranch = "main";
    const repoRes = await githubFetch(repoPath, token);
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        return NextResponse.json(
          { error: `Repository ${owner}/${repo} not found (or no access)` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch repo info: ${repoRes.status}` },
        { status: 502 }
      );
    }
    const repoData = await repoRes.json();
    defaultBranch = repoData.default_branch || "main";

    // Step 1: Get the current HEAD SHA of the branch
    let headSha: string;
    const refRes = await githubFetch(
      `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );

    if (!refRes.ok) {
      if (refRes.status === 404 && createBranch && branch !== defaultBranch) {
        // Branch doesn't exist — create it from the default branch
        const defaultRefRes = await githubFetch(
          `${repoPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
          token
        );
        if (!defaultRefRes.ok) {
          return NextResponse.json(
            { error: `Default branch ${defaultBranch} not found` },
            { status: 404 }
          );
        }
        const defaultRef: GitRef = await defaultRefRes.json();
        headSha = defaultRef.object.sha;

        // Create the new branch
        const createRefRes = await githubFetch(`${repoPath}/git/refs`, token, {
          method: "POST",
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: headSha,
          }),
        });
        if (!createRefRes.ok) {
          const err = await createRefRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: `Failed to create branch ${branch}`, detail: err.message || createRefRes.statusText },
            { status: 502 }
          );
        }
      } else {
        const err = await refRes.json().catch(() => ({}));
        return NextResponse.json(
          { error: `Branch ${branch} not found`, detail: err.message || refRes.statusText },
          { status: 404 }
        );
      }
    } else {
      const ref: GitRef = await refRes.json();
      headSha = ref.object.sha;
    }

    // Step 2: Get the current tree SHA from the HEAD commit
    const commitRes = await githubFetch(`${repoPath}/git/commits/${headSha}`, token);
    if (!commitRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch HEAD commit: ${commitRes.status}` },
        { status: 502 }
      );
    }
    const headCommit: GitCommit = await commitRes.json();
    const baseTreeSha = headCommit.tree.sha;

    // Step 3: Create a new tree with the file changes
    const treeEntries = (files as CommitFile[]).map((f) => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      content: f.content,
    }));

    const treeRes = await githubFetch(`${repoPath}/git/trees`, token, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });
    if (!treeRes.ok) {
      const err = await treeRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to create tree", detail: err.message || treeRes.statusText },
        { status: 502 }
      );
    }
    const newTree: GitTree = await treeRes.json();
    const newTreeSha = newTree.sha;

    // Step 4: Create the commit
    const commitAuthor = {
      name: user.githubUsername || user.email || "Soroban.Build User",
      email: user.email || `${user.githubUsername}@users.noreply.github.com`,
      date: new Date().toISOString(),
    };

    const newCommitRes = await githubFetch(`${repoPath}/git/commits`, token, {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: newTreeSha,
        parents: [headSha],
        author: commitAuthor,
        committer: commitAuthor,
      }),
    });
    if (!newCommitRes.ok) {
      const err = await newCommitRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to create commit", detail: err.message || newCommitRes.statusText },
        { status: 502 }
      );
    }
    const newCommit: GitCommit = await newCommitRes.json();
    const newCommitSha = newCommit.sha;

    // Step 5: Update the branch ref to point to the new commit
    const updateRefRes = await githubFetch(
      `${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({
          sha: newCommitSha,
          force: false,
        }),
      }
    );
    if (!updateRefRes.ok) {
      const err = await updateRefRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: "Commit created but branch update failed",
          detail: err.message || updateRefRes.statusText,
          commitSha: newCommitSha,
        },
        { status: 502 }
      );
    }

    // Record audit log if this project is linked
    return NextResponse.json({
      commitSha: newCommitSha,
      commitUrl: newCommit.html_url,
      branch,
      message,
      fileCount: files.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to commit to GitHub", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
