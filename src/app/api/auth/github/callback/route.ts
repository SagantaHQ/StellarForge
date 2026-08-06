import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/auth/github/callback?code=XXX&state=BASE64(JSON)
 *
 * GitHub redirects here after the user authorizes the OAuth app. We:
 *   1. Decode the state to get walletAddress + popup flag
 *   2. Exchange the code for an access token
 *   3. Fetch the user's GitHub profile (username)
 *   4. Store the access token on the User record
 *   5. Either:
 *      a. Popup mode (p=1): render HTML that postMessages to the opener
 *         window and closes itself. The parent window listens for the
 *         message and refreshes GitHub status.
 *      b. Redirect mode (p=0): redirect the main page to /?github_connected=1
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER = "https://api.github.com/user";

interface StatePayload {
  w: string; // wallet address
  p: number; // popup flag (1 = popup mode)
}

function decodeState(state: string): StatePayload | null {
  try {
    const json = Buffer.from(state, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.w === "string") {
      return { w: parsed.w, p: parsed.p ?? 0 };
    }
    // Fallback: old format was just the raw wallet address
    return { w: json, p: 0 };
  } catch {
    return null;
  }
}

/**
 * Detect the app's public URL — same logic as the initiation route.
 * See /api/auth/github/route.ts for the full explanation.
 *
 * The browser's `origin`/`referer` headers are the most reliable signal
 * because they always contain the public URL the user sees, even when
 * the request passes through reverse proxies that rewrite the `host`
 * header to an internal hostname.
 */
function detectAppUrl(req: NextRequest): string {
  // 1. Explicit env var override
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }

  const isLocalhost = (host: string) =>
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("[::1]") ||
    host.includes("0.0.0.0");

  const withProtocol = (host: string) => {
    const proto = isLocalhost(host) ? "http" : "https";
    return `${proto}://${host}`;
  };

  // 2. Origin header
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // fall through
    }
  }

  // 3. Referer header
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // fall through
    }
  }

  // 4. x-forwarded-host (force https for non-localhost)
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = isLocalhost(host) ? "http" : "https";
    return `${proto}://${host}`;
  }

  // 5. host header
  const host = req.headers.get("host");
  if (host) {
    return withProtocol(host);
  }

  return "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const appUrl = detectAppUrl(req);

  // Handle user denying authorization
  if (error) {
    return handleResponse(false, { error }, 0, appUrl);
  }

  if (!code || !state) {
    return handleResponse(false, { error: "Missing code or state" }, 0, appUrl);
  }

  // Decode the state
  const statePayload = decodeState(state);
  if (!statePayload) {
    return handleResponse(false, { error: "Invalid state param" }, 0, appUrl);
  }

  const walletAddress = statePayload.w;
  const isPopup = statePayload.p === 1;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return handleResponse(
      false,
      { error: "GitHub OAuth not configured" },
      isPopup ? 1 : 0,
      appUrl
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
    return handleResponse(
      false,
      { error: `Token exchange failed: ${msg}` },
      isPopup ? 1 : 0,
      appUrl
    );
  }

  // Step 2: Fetch the user's GitHub profile
  let githubUsername: string;
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleResponse(
      false,
      { error: `GitHub profile fetch failed: ${msg}` },
      isPopup ? 1 : 0,
      appUrl
    );
  }

  // Step 3: Find the user by wallet address and store the token
  try {
    const user = await db.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      return handleResponse(
        false,
        { error: "User not found — connect your wallet first" },
        isPopup ? 1 : 0,
        appUrl
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        githubAccessToken: accessToken,
        githubUsername,
        githubConnectedAt: new Date(),
      },
    });

    return handleResponse(true, { username: githubUsername }, isPopup ? 1 : 0, appUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleResponse(
      false,
      { error: `Failed to save GitHub token: ${msg}` },
      isPopup ? 1 : 0,
      appUrl
    );
  }
}

/**
 * Return either a redirect (non-popup) or an HTML page that postMessages
 * to the opener window and closes itself (popup mode).
 */
function handleResponse(
  success: boolean,
  data: { username?: string; error?: string },
  popup: number,
  appUrl: string
): NextResponse {
  // Non-popup mode: redirect the main page
  if (popup === 0) {
    if (success && data.username) {
      return NextResponse.redirect(
        `${appUrl}/?github_connected=1&github_username=${encodeURIComponent(data.username)}`
      );
    }
    return NextResponse.redirect(
      `${appUrl}/?github_error=${encodeURIComponent(data.error || "Unknown error")}`
    );
  }

  // Popup mode: render an HTML page that communicates with the opener.
  // The parent window (IDE) listens for a 'github_oauth' message event
  // and refreshes GitHub status. The popup closes itself after sending.
  const message = success
    ? { type: "github_oauth", success: true, username: data.username }
    : { type: "github_oauth", success: false, error: data.error };

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GitHub OAuth</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0d1117;
      color: #c9d1d9;
    }
    .card {
      text-align: center;
      padding: 32px;
    }
    .icon {
      font-size: 40px;
      margin-bottom: 12px;
    }
    h1 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
    p { font-size: 13px; color: #8b949e; margin: 0; }
    .spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 2px solid #30363d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>${success ? "Connected!" : "Connection failed"}</h1>
    <p>${success ? "You can close this window." : data.error || "Please try again."}</p>
  </div>
  <script>
    (function() {
      var msg = ${JSON.stringify(message)};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(msg, "*");
        }
      } catch (e) {}
      // Close after a short delay so the message is delivered
      setTimeout(function() { window.close(); }, 800);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
