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
 * When `popup=1` is passed, the callback renders an HTML page that
 * calls window.opener.postMessage() and closes itself, instead of
 * redirecting the main page. This allows the OAuth flow to happen in a
 * popup window so the IDE stays open.
 *
 * Debug mode: pass ?debug=1 to return JSON with the detected app URL
 * and all relevant headers instead of redirecting. Use this to diagnose
 * redirect_uri mismatch errors.
 *
 * Scopes:
 *   - repo: full access to public and private repos (for import + commit)
 *   - user:email: read the user's email (for account linking)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";

/**
 * Detect the app's public URL from the incoming request.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL env var (explicit override — always wins)
 *   2. x-forwarded-proto + x-forwarded-host headers (set by reverse proxies)
 *   3. host header (direct access)
 *
 * Protocol rules:
 *   - localhost / 127.0.0.1 / [::1] → http (local dev)
 *   - everything else → https (all preview/production deployments use TLS)
 *
 * This forced-https for non-localhost is critical because many reverse
 * proxies terminate TLS and forward requests as HTTP, so the
 * x-forwarded-proto header may be missing or "http" even though the
 * user's browser is on https://. GitHub requires the redirect_uri to
 * match exactly, including the protocol.
 */
function detectAppUrl(req: NextRequest): string {
  // 1. Explicit env var override
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""); // strip trailing slash
  }

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");

  if (!host) {
    return "http://localhost:3000";
  }

  // 2. Determine protocol
  //    - localhost → http (local dev)
  //    - everything else → https (preview/prod are always behind TLS)
  const isLocalhost =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("[::1]");

  let proto: string;
  if (isLocalhost) {
    proto = "http";
  } else if (forwardedProto) {
    // x-forwarded-proto may be a comma-separated list (e.g. "https,http")
    // if there are multiple proxy hops — take the first one (original client proto)
    proto = forwardedProto.split(",")[0].trim();
  } else {
    // No x-forwarded-proto header — assume https for non-localhost
    proto = "https";
  }

  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const walletAddress = url.searchParams.get("walletAddress");
  const popup = url.searchParams.get("popup") === "1";
  const debug = url.searchParams.get("debug") === "1";

  const appUrl = detectAppUrl(req);
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  // Debug mode — return JSON with the detected URL + headers for diagnosis
  if (debug) {
    return NextResponse.json({
      detectedAppUrl: appUrl,
      redirectUri,
      popup,
      walletAddress: walletAddress ? `${walletAddress.substring(0, 6)}…` : null,
      env: {
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ? "✓ set" : "✗ missing",
      },
      headers: {
        host: req.headers.get("host"),
        "x-forwarded-host": req.headers.get("x-forwarded-host"),
        "x-forwarded-proto": req.headers.get("x-forwarded-proto"),
        "x-forwarded-for": req.headers.get("x-forwarded-for"),
      },
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

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
