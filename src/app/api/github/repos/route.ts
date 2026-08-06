import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/github/repos?walletAddress=GXXX
 *
 * Lists the authenticated user's GitHub repositories using their stored
 * access token. Returns repos sorted by last-updated descending.
 *
 * The user must have connected their GitHub account first (via
 * /api/auth/github). If not connected, returns 401 with a helpful message.
 *
 * Response:
 *   {
 *     repos: [{ id, name, full_name, private, description, default_branch,
 *               updated_at, language, html_url, stargazers_count }],
 *     username: "octocat"
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API_REPOS = "https://api.github.com/user/repos";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  updated_at: string;
  language: string | null;
  html_url: string;
  stargazers_count: number;
  fork: boolean;
  owner: { login: string; avatar_url: string };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
    }

    // Find the user and their GitHub token
    const user = await db.user.findUnique({
      where: { walletAddress },
      select: {
        id: true,
        githubAccessToken: true,
        githubUsername: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.githubAccessToken) {
      return NextResponse.json(
        {
          error: "GitHub not connected",
          detail: "Connect your GitHub account to browse repos.",
          needsConnect: true,
        },
        { status: 401 }
      );
    }

    // Fetch repos from GitHub API
    const type = url.searchParams.get("type") || "all"; // all, owner, public, private
    const perPage = Math.min(parseInt(url.searchParams.get("per_page") || "100"), 100);
    const sort = url.searchParams.get("sort") || "updated"; // created, updated, pushed, full_name

    const res = await fetch(
      `${GITHUB_API_REPOS}?type=${type}&per_page=${perPage}&sort=${sort}&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${user.githubAccessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Soroban.Build",
        },
        // Don't cache — we want fresh repo list
        cache: "no-store",
      }
    );

    if (!res.ok) {
      if (res.status === 401) {
        // Token expired or revoked — clear it from the DB
        await db.user.update({
          where: { id: user.id },
          data: {
            githubAccessToken: null,
            githubUsername: null,
            githubConnectedAt: null,
          },
        });
        return NextResponse.json(
          {
            error: "GitHub token expired or revoked",
            detail: "Please reconnect your GitHub account.",
            needsConnect: true,
          },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: `GitHub API error: ${res.status}` },
        { status: 502 }
      );
    }

    const repos: GitHubRepo[] = await res.json();

    return NextResponse.json({
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        description: r.description,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
        language: r.language,
        html_url: r.html_url,
        stargazers_count: r.stargazers_count,
        fork: r.fork,
        owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
      })),
      username: user.githubUsername,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch repos", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
