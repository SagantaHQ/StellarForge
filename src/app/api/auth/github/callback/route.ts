import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/auth/github/callback?code=XXX&state=BASE64(WALLET_ADDRESS)
 *
 * GitHub redirects here after the user authorizes the OAuth app. We:
 *   1. Exchange the code for an access token (POST to github.com/login/oauth/access_token)
 *   2. Fetch the user's GitHub profile (to get their GitHub username)
 *   3. Store the access token + username on the User record (matched by walletAddress)
 *   4. Redirect back to the IDE with a success indicator
 *
 * The access token is stored in the database (encrypted at rest in production).
 * It's used for:
 *   - Listing the user's repos (GET /api/github/repos)
 *   - Committing changes back to GitHub (POST /api/github/commit)
 *   - Importing repos by URL (POST /api/projects/import-git — uses the token
 *     for private repos instead of public shallow clone)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER = "https://api.github.com/user";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;

  // Handle user denying authorization
  if (error) {
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent("Missing code or state")}`
    );
  }

  // Decode the wallet address from the state param
  let walletAddress: string;
  try {
    walletAddress = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent("Invalid state param")}`
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent("GitHub OAuth not configured")}`
    );
  }

  // Step 1: Exchange code for access token
  let accessToken: string;
  try {
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error(
        tokenData.error_description || tokenData.error || "No access_token in response"
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent(`Token exchange failed: ${msg}`)}`
    );
  }

  // Step 2: Fetch the user's GitHub profile
  let githubUsername: string;
  let githubAvatarUrl: string | null = null;
  try {
    const userRes = await fetch(GITHUB_API_USER, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Soroban.Build",
      },
    });

    if (!userRes.ok) {
      throw new Error(`GitHub user fetch failed: ${userRes.status}`);
    }

    const userData = await userRes.json();
    githubUsername = userData.login;
    githubAvatarUrl = userData.avatar_url ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent(`GitHub profile fetch failed: ${msg}`)}`
    );
  }

  // Step 3: Find the user by wallet address and store the token
  try {
    const user = await db.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      return NextResponse.redirect(
        `${appUrl}/?github_error=${encodeURIComponent("User not found — connect your wallet first")}`
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        githubAccessToken: accessToken,
        githubUsername,
        githubConnectedAt: new Date(),
        // Use the GitHub avatar if the user doesn't have one set
        email: user.email ?? null,
      },
    });

    // Redirect back to the IDE with a success flag — the client will
    // detect this and refresh the GitHub connection state.
    return NextResponse.redirect(
      `${appUrl}/?github_connected=1&github_username=${encodeURIComponent(githubUsername)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent(`Failed to save GitHub token: ${msg}`)}`
    );
  }
}
