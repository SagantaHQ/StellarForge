import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/github?walletAddress=GXXX&popup=1
 *
 * Initiates the GitHub OAuth flow by redirecting to GitHub's authorization
 * page. After the user authorizes, GitHub redirects back to
 * /api/auth/github/callback with `code` and `state` query params.
 *
 * The `state` param is a base64url-encoded JSON object containing:
 *   - w: walletAddress (identifies which user is completing OAuth)
 *   - p: popup flag (1 = render HTML callback that postMessages to opener)
 *
 * When `popup=1` is passed, the callback will render an HTML page that
 * calls window.opener.postMessage() and closes itself, instead of
 * redirecting the main page. This allows the OAuth flow to happen in a
 * popup window so the IDE stays open.
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
  const popup = url.searchParams.get("popup") === "1";

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

  // Compute the app URL for the OAuth redirect_uri.
  // Priority:
  //   1. NEXT_PUBLIC_APP_URL env var (if set)
  //   2. x-forwarded-proto + x-forwarded-host headers (reverse proxy)
  //   3. host header (direct access)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  // State is a base64url-encoded JSON object. This prevents CSRF and carries
  // the wallet address + popup flag through the OAuth round-trip.
  const state = Buffer.from(
    JSON.stringify({ w: walletAddress, p: popup ? 1 : 0 })
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo user:email",
    state,
    allow_signup: "true",
  });

  return NextResponse.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
}
