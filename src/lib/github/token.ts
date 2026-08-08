import { db } from "@/lib/db";

/**
 * GitHub token resolution helper.
 *
 * Resolves the appropriate GitHub access token for API operations:
 *   1. User's OAuth token (if they've connected GitHub via OAuth)
 *   2. Server-side PAT (GITHUB_SERVER_TOKEN env var, permanent fallback)
 *
 * The server PAT allows the app to perform GitHub operations (clone repos,
 * read repo metadata) even when the user hasn't connected their own GitHub
 * account. This is useful for:
 *   - Importing public repos by URL without requiring OAuth
 *   - Server-side git clone operations
 *   - Reading repo metadata for the import flow
 *
 * For write operations (commit, push), the user's own OAuth token is
 * preferred so commits are attributed to the user, not the server token's
 * owner. The server PAT is a last-resort fallback.
 */

export interface TokenResult {
  token: string;
  source: "user-oauth" | "server-pat";
  username?: string;
}

/**
 * Resolve the GitHub token for a given wallet address.
 * Returns the user's OAuth token if available, otherwise falls back to
 * the server PAT.
 */
export async function resolveGithubToken(
  walletAddress?: string | null
): Promise<TokenResult | null> {
  // 1. Try the user's OAuth token
  if (walletAddress) {
    try {
      const user = await db.user.findUnique({
        where: { walletAddress },
        select: { githubAccessToken: true, githubUsername: true },
      });
      if (user?.githubAccessToken) {
        return {
          token: user.githubAccessToken,
          source: "user-oauth",
          username: user.githubUsername ?? undefined,
        };
      }
    } catch {
      // DB unavailable or user not found — fall through to server PAT
    }
  }

  // 2. Fall back to the server PAT
  const serverToken = process.env.GITHUB_SERVER_TOKEN;
  if (serverToken) {
    return { token: serverToken, source: "server-pat" };
  }

  return null;
}

/**
 * Get the server PAT only (for operations that should always use the
 * server identity, like cloning repos during import).
 */
export function getServerToken(): string | null {
  return process.env.GITHUB_SERVER_TOKEN || null;
}

/**
 * Check if a token has access to a specific repo (for error messages).
 */
export async function checkRepoAccess(
  token: string,
  owner: string,
  repo: string
): Promise<{ accessible: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Soroban.Build",
        },
      }
    );
    if (res.ok) return { accessible: true };
    if (res.status === 404) return { accessible: false, error: "Repository not found or no access" };
    if (res.status === 401) return { accessible: false, error: "Token expired or invalid" };
    return { accessible: false, error: `GitHub API error: ${res.status}` };
  } catch {
    return { accessible: false, error: "Failed to check repo access" };
  }
}
