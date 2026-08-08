"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Message to display under the spinner */
  message?: string;
  /** Optional submessage for additional context */
  submessage?: string;
  /** Render as a full-screen overlay (fixed) vs. absolute within a container */
  variant?: "fullscreen" | "inline";
  /** Optional className for the container */
  className?: string;
}

/**
 * Reusable loading overlay — shows a centered spinner with a message.
 *
 * Use `variant="fullscreen"` for app-wide operations (project switching,
 * importing) and `variant="inline"` for panel-level operations (fetching
 * repos, committing, comparing files).
 *
 * The overlay appears on top of the content with a semi-transparent
 * backdrop so the user can see what's happening behind it.
 */
export function LoadingOverlay({
  visible,
  message = "Loading…",
  submessage,
  variant = "inline",
  className,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-center z-50",
        variant === "fullscreen"
          ? "fixed inset-0 bg-black/40 backdrop-blur-sm"
          : "absolute inset-0 bg-[var(--surface-app)]/80 backdrop-blur-sm",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="flex flex-col items-center gap-3 px-6 py-4">
        <Loader2
          size={variant === "fullscreen" ? 32 : 24}
          strokeWidth={1.75}
          className="animate-spin text-[var(--accent)]"
        />
        <div className="text-center">
          <div
            className={cn(
              "font-medium text-[var(--text-primary)]",
              variant === "fullscreen" ? "text-sm" : "text-[12px]"
            )}
          >
            {message}
          </div>
          {submessage && (
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              {submessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline spinner — for small loading states (buttons, inline text).
 * Use this when you don't need a full overlay.
 */
export function InlineSpinner({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Loader2
      size={size}
      strokeWidth={1.75}
      className={cn("animate-spin", className)}
    />
  );
}
