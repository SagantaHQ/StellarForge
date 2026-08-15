import { NextRequest, NextResponse } from "next/server";
import { resolveGithubToken } from "@/lib/github/token";

/**
 * POST /api/github/create-repo
 *
 * Creates a new GitHub repository using the user's OAuth token (or server
 * PAT as fallback). Returns the created repo info.
 *
 * Body:
 *   {
 *     walletAddress: string,
 *     name: string,           // repo name (e.g. "my-contract")
 *     description?: string,   // optional repo description
 *     private?: boolean,      // default: false (public)
 *     autoInit?: boolean      // default: false (don't auto-init with README)
 *   }
 *
 * Returns:
 *   { repo: { id, name, full_name, private, default_branch, html_url, owner: { login } } }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_API = "https://api.github.com";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, name, description, private: isPrivate, autoInit } = body;

    if (!walletAddress || !name) {
      return NextResponse.json(
        { error: "Missing required fields: walletAddress, name" },
        { status: 400 }
      );
    }

    // Validate repo name (GitHub rules: alphanumeric + hyphens + underscores, max 100 chars)
    const validName = /^[a-zA-Z0-9_-]+$/.test(name) && name.length <= 100;
    if (!validName) {
      return NextResponse.json(
        { error: "Invalid repo name. Use only letters, numbers, hyphens, and underscores (max 100 chars)." },
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

    // Create the repo via GitHub API
    // POST /user/repos creates a repo owned by the authenticated user
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "StellarForge",
      },
      body: JSON.stringify({
        name,
        description: description || `Soroban smart contract: ${name}`,
        private: isPrivate ?? false,
        auto_init: autoInit ?? false,
        // Don't create a gitignore/license — the project files will be
        // committed via the commit flow
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 422) {
        return NextResponse.json(
          {
            error: `Repository '${name}' already exists or name is unavailable`,
            detail: errData.message || errData.errors?.[0]?.message,
          },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { error: `Failed to create repo: ${res.status}`, detail: errData.message },
        { status: 502 }
      );
    }

    const repo = await res.json();

    return NextResponse.json({
      repo: {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        default_branch: repo.default_branch,
        html_url: repo.html_url,
        owner: { login: repo.owner.login },
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create repo", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
