import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { AVATAR_CONFIG } from "@/lib/config/avatar";

/**
 * POST /api/profile/avatar
 *
 * Processes and uploads an avatar image:
 *   1. Validates file size (≤ 2MB) and MIME type
 *   2. Converts to WebP format
 *   3. Strips ALL metadata (EXIF, GPS, etc.)
 *   4. Resizes to 512×512 (if larger) — square crop enforced client-side
 *   5. Compresses to quality 75 (small file size)
 *   6. Stores as base64 data URL in Postgres (Profile.avatarUrl)
 *
 * Body: { address, imageData (base64 data URL) }
 * Returns: { avatarUrl }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, imageData } = body;

    if (!address || !imageData) {
      return NextResponse.json({ error: "Missing address or imageData" }, { status: 400 });
    }

    // Validate the data URL prefix
    if (!imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid image data URL" }, { status: 400 });
    }

    // Extract the base64 data
    const matches = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches || !matches[2]) {
      return NextResponse.json({ error: "Invalid base64 image data" }, { status: 400 });
    }

    const mimeType = matches[1];
    if (!AVATAR_CONFIG.allowedTypes.includes(mimeType)) {
      return NextResponse.json({
        error: `Unsupported image type: ${mimeType}. Allowed: ${AVATAR_CONFIG.allowedTypes.join(", ")}`,
      }, { status: 400 });
    }

    const base64Data = matches[2];
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Check file size
    if (imageBuffer.length > AVATAR_CONFIG.maxFileSize) {
      return NextResponse.json({
        error: `Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB. Max: ${AVATAR_CONFIG.maxFileSizeLabel}`,
      }, { status: 400 });
    }

    // Process with sharp:
    //   - Convert to WebP
    //   - Strip ALL metadata (EXIF, GPS, ICC, etc.)
    //   - Resize to 512×512 max (cover, not stretch)
    //   - Quality 75 for small file size
    const processedBuffer = await sharp(imageBuffer)
      .resize(AVATAR_CONFIG.maxSize, AVATAR_CONFIG.maxSize, {
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      })
      .webp({
        quality: AVATAR_CONFIG.quality,
        effort: 4,
      })
      .withMetadata({}) // explicitly strip all metadata — empty object = no metadata
      .toBuffer();

    // Convert to base64 data URL for storage
    const processedDataUrl = `data:image/webp;base64,${processedBuffer.toString("base64")}`;

    // Find user by wallet address
    const user = await db.user.findUnique({
      where: { walletAddress: address },
      include: { profile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.profile) {
      return NextResponse.json({ error: "Profile not found — complete profile setup first" }, { status: 404 });
    }

    // Update the profile avatar
    await db.profile.update({
      where: { id: user.profile.id },
      data: { avatarUrl: processedDataUrl },
    });

    return NextResponse.json({
      avatarUrl: processedDataUrl,
      size: processedBuffer.length,
      format: AVATAR_CONFIG.format,
      dimensions: `${AVATAR_CONFIG.maxSize}x${AVATAR_CONFIG.maxSize}`,
    });
  } catch (err) {
    console.error("[Avatar] Processing error:", err);
    return NextResponse.json(
      { error: "Failed to process avatar", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
