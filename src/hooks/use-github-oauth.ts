"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProfileStore } from "@/stores/profile-store";

/**
 * useGithubOAuth — manages the GitHub OAuth popup flow.
 *
 * Instead of redirecting the main page away from the IDE (which loses
 * editor state), we open the OAuth flow in a popup window. The callback
 * route (when called with popup=1) renders an HTML page that
 * postMessages back to this window and closes itself.
 *
 * Usage:
 *   const { connectGithub, connecting, error } = useGithubOAuth();
 *   <button onClick={connectGithub}>Connect GitHub</button>
 *
 * The hook automatically refreshes the GitHub connection status in the
 * profile store after a successful popup callback.
 */

interface OAuthMessage {
  type: "github_oauth";
  success: boolean;
  username?: string;
  error?: string;
}

const POPUP_WIDTH = 640;
const POPUP_HEIGHT = 760;

function centerPopup() {
  const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
  const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
  return { left: Math.round(left), top: Math.round(top) };
}

export function useGithubOAuth() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const profile = useProfileStore((s) => s.profile);
  const syncGithubStatus = useProfileStore((s) => s.syncGithubStatus);

  // Listen for the postMessage from the popup callback
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as OAuthMessage;
      // Only handle our specific message type
      if (!data || data.type !== "github_oauth") return;

      setConnecting(false);

      if (data.success) {
        // Refresh GitHub status in the store
        syncGithubStatus();
        setError(null);
      } else {
        setError(data.error || "GitHub connection failed");
      }

      // The popup closes itself, but clear our ref just in case
      popupRef.current = null;
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [syncGithubStatus]);

  // Poll for popup closure (user might close it manually without completing)
  useEffect(() => {
    if (!connecting) return;
    const interval = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        setConnecting(false);
        popupRef.current = null;
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [connecting]);

  const connectGithub = useCallback(async () => {
    if (!profile?.address) {
      setError("You must be logged in to connect GitHub.");
      return;
    }

    setError(null);
    setConnecting(true);

    // Build the OAuth URL — popup=1 tells the callback to render HTML
    // that postMessages back to us instead of redirecting
    const oauthUrl = `/api/auth/github?walletAddress=${encodeURIComponent(
      profile.address
    )}&popup=1`;

    const { left, top } = centerPopup();
    const features = `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no,scrollbars=yes,resizable=yes`;

    // Open the popup
    popupRef.current = window.open(oauthUrl, "github-oauth", features);

    if (!popupRef.current) {
      setConnecting(false);
      setError("Popup blocked. Please allow popups for this site and try again.");
      return;
    }

    // Focus the popup (in case it opened behind the main window)
    popupRef.current.focus();
  }, [profile?.address]);

  return { connectGithub, connecting, error, setError };
}
