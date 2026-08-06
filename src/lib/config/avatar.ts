/**
 * Avatar upload configuration.
 *
 * Centralized config for avatar processing — edit here to change limits.
 */

export const AVATAR_CONFIG = {
  /** Maximum file size before processing (2MB) */
  maxFileSize: 2 * 1024 * 1024,
  /** Output format */
  format: "webp" as const,
  /** Output quality (70-80 for small size) */
  quality: 75,
  /** Maximum dimensions (square) */
  maxSize: 512,
  /** Minimum dimensions (square) — enforced client-side via crop */
  minSize: 64,
  /** Allowed MIME types */
  allowedTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  /** Max file size label for UI */
  maxFileSizeLabel: "2MB",
} as const;
