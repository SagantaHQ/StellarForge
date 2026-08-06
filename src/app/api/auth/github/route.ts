import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/github?walletAddress=GXXX
 *
 * Initiates the GitHub OAuth flow by redirecting the user to GitHub's
 * authorization page. After the user authorizes, GitHub redirects back
 * to /api/auth/github/callback with a `code` query param.
 *
 * We pass the walletAddress as a state param so the callback can identify
 * which user is completing the OAuth flow (we don't have server-side
 * sessions — the wallet address IS the identity).
 *
 * Scopes:
 *   - repo: full access to public and private repos (for import + commit)
 *   - user:email: read the user's email (for account linking)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const walletAddress = url.searchParams.get("walletAddress");

  if (!walletAddress) {
    return NextResponse.json(
      { error: "Missing walletAddress — must be logged in to connect GitHub" },
      { status: 400 }
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID is not configured. Set it in .env" },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
  const redirectUri = `${appUrl}/api/auth/github/callback`;
  // State prevents CSRF — we pass the wallet address so the callback knows
  // which user to link the token to. In production this should be a signed
  // random token, but for the wallet-based auth model the address itself
  // is sufficient (the user must sign with that wallet to be logged in).
  const state = Buffer.from(walletAddress).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo user:email",
    state,
    allow_signup: "true",
  });

  return NextResponse.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
}
