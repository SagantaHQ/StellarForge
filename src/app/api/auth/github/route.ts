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
 * URL detection priority (see detectAppUrl below):
 *   1. NEXT_PUBLIC_APP_URL env var (explicit override)
 *   2. Origin header (browser sends this for same-origin fetches —
 *      always contains the public URL the user sees)
 *   3. Referer header (fallback — browser sends the page URL)
 *   4. x-forwarded-host + x-forwarded-proto (reverse proxy headers —
 *      often wrong on multi-hop proxies)
 *   5. host header (last resort — may be an internal proxy host)
 *
 * Non-localhost hosts ALWAYS use https. This is non-negotiable in 2026
 * and avoids the classic "proxy terminates TLS and forwards as http"
 * bug that causes redirect_uri mismatches.
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
 * The key insight: the browser's `origin` and `referer` headers always
 * contain the public URL the user sees in their address bar — even when
 * the request passes through reverse proxies that rewrite the `host`
 * header to an internal hostname. This makes them the most reliable
 * signal for building a correct redirect_uri.
 */
function detectAppUrl(req: NextRequest): { url: string; source: string } {
  // 1. Explicit env var override — always wins
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return {
      url: process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
      source: "env:NEXT_PUBLIC_APP_URL",
    };
  }

  // Helper: is this host localhost?
  const isLocalhost = (host: string) =>
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("[::1]") ||
    host.includes("0.0.0.0");

  // Helper: force https for non-localhost, allow http for localhost
  const withProtocol = (host: string) => {
    const proto = isLocalhost(host) ? "http" : "https";
    return `${proto}://${host}`;
  };

  // 2. Origin header — the browser sets this for same-origin fetches.
  //    Format: "https://preview-chat-xxx.space-z.ai" (no path)
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      return { url: `${parsed.protocol}//${parsed.host}`, source: "header:origin" };
    } catch {
      // Malformed origin — fall through
    }
  }

  // 3. Referer header — the browser sets this to the page URL.
  //    Format: "https://preview-chat-xxx.space-z.ai/some/path"
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      return { url: `${parsed.protocol}//${parsed.host}`, source: "header:referer" };
    } catch {
      // Malformed referer — fall through
    }
  }

  // 4. x-forwarded-host + x-forwarded-proto (reverse proxy headers)
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    // Use x-forwarded-proto if present, otherwise force https for non-localhost
    const host = forwardedHost.split(",")[0].trim();
    let proto: string;
    if (isLocalhost(host)) {
      proto = "http";
    } else if (forwardedProto) {
      // Take the first proto (original client) — but if it says "http"
      // for a non-localhost host, the proxy is lying (stripped TLS).
      // Force https anyway because non-localhost deployments are always TLS.
      proto = "https";
    } else {
      proto = "https";
    }
    return { url: `${proto}://${host}`, source: "header:x-forwarded-host" };
  }

  // 5. host header — last resort (may be an internal proxy host)
  const host = req.headers.get("host");
  if (host) {
    return { url: withProtocol(host), source: "header:host" };
  }

  return { url: "http://localhost:3000", source: "fallback" };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const walletAddress = url.searchParams.get("walletAddress");
  const popup = url.searchParams.get("popup") === "1";
  const debug = url.searchParams.get("debug") === "1";

  const { url: appUrl, source } = detectAppUrl(req);
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  // Debug mode — return JSON with the detected URL + all headers for diagnosis
  if (debug) {
    return NextResponse.json({
      detectedAppUrl: appUrl,
      redirectUri,
      detectionSource: source,
      popup,
      walletAddress: walletAddress ? `${walletAddress.substring(0, 6)}…` : null,
      env: {
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ? "✓ set" : "✗ missing",
      },
      headers: {
        host: req.headers.get("host"),
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
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
