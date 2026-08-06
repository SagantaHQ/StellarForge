"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Crop, Check, X, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AVATAR_CONFIG } from "@/lib/config/avatar";

/**
 * Avatar uploader with client-side square cropping.
 *
 * Flow:
 *   1. User selects a file (validated: size ≤ 2MB, type allowed)
 *   2. Image loads into a canvas with a square crop overlay
 *   3. User drags to position the crop
 *   4. User can zoom with the slider
 *   5. On "Apply" → canvas exports as base64 → uploaded to /api/profile/avatar
 *   6. Server processes with sharp (WebP, strip metadata, resize 512×512, quality 75)
 */

interface AvatarUploaderProps {
  address: string;
  currentAvatar?: string;
  onUploaded: (avatarUrl: string) => void;
  onCancel: () => void;
}

export function AvatarUploader({ address, currentAvatar, onUploaded, onCancel }: AvatarUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Crop state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const CANVAS_SIZE = 256; // display size

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (!AVATAR_CONFIG.allowedTypes.includes(file.type)) {
      setError(`Unsupported type: ${file.type}. Use JPEG, PNG, WebP, or GIF.`);
      return;
    }

    if (file.size > AVATAR_CONFIG.maxFileSize) {
      setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: ${AVATAR_CONFIG.maxFileSizeLabel}`);
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(reader.result as string);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
  }, []);

  // Draw the canvas whenever image/zoom/offset changes
  useEffect(() => {
    if (!imageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      drawCanvas(ctx, img, zoom, offset, CANVAS_SIZE);
    };
    img.src = imageUrl;
  }, [imageUrl, zoom, offset]);

  function drawCanvas(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    zoom: number,
    offset: { x: number; y: number },
    size: number
  ) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#131418";
    ctx.fillRect(0, 0, size, size);

    // Calculate scaled dimensions to cover the canvas
    const scale = Math.max(size / img.width, size / img.height) * zoom;
    const scaledW = img.width * scale;
    const scaledH = img.height * scale;
    const x = (size - scaledW) / 2 + offset.x;
    const y = (size - scaledH) / 2 + offset.y;

    // Draw image centered
    ctx.drawImage(img, x, y, scaledW, scaledH);

    // Draw crop overlay (square in center)
    ctx.strokeStyle = "rgba(79, 140, 140, 0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);

    // Darken outside the square (already square canvas, so just draw border)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  function handleMouseDown(e: React.MouseEvent) {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleReset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  async function handleApply() {
    if (!canvasRef.current || !imageRef.current) return;
    setUploading(true);
    setError(null);

    try {
      // Export at full resolution (512×512)
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = AVATAR_CONFIG.maxSize;
      exportCanvas.height = AVATAR_CONFIG.maxSize;
      const exportCtx = exportCanvas.getContext("2d");
      if (!exportCtx) throw new Error("Canvas not supported");

      // Scale up the crop to 512×512
      const img = imageRef.current;
      const scale = Math.max(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * zoom;
      const scaledW = img.width * scale;
      const scaledH = img.height * scale;
      const x = (CANVAS_SIZE - scaledW) / 2 + offset.x;
      const y = (CANVAS_SIZE - scaledH) / 2 + offset.y;

      // Draw at full 512×512 resolution
      const fullScale = AVATAR_CONFIG.maxSize / CANVAS_SIZE;
      exportCtx.drawImage(
        img,
        (x / CANVAS_SIZE) * img.width / (scale * CANVAS_SIZE / img.width) * -1 + 0,
        0,
        img.width,
        img.height,
        0,
        0,
        AVATAR_CONFIG.maxSize,
        AVATAR_CONFIG.maxSize
      );

      // Simpler approach: draw the canvas content scaled up
      exportCtx.clearRect(0, 0, AVATAR_CONFIG.maxSize, AVATAR_CONFIG.maxSize);
      exportCtx.drawImage(canvasRef.current, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, 0, AVATAR_CONFIG.maxSize, AVATAR_CONFIG.maxSize);

      const dataUrl = exportCanvas.toDataURL("image/webp", 0.9);

      // Upload to server for sharp processing
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          imageData: dataUrl,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }

      const data = await res.json();
      onUploaded(data.avatarUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  // If no file selected, show the file picker
  if (!imageUrl) {
    return (
      <div className="space-y-3">
        <label className="cursor-pointer block">
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)] p-6 hover:border-[var(--accent)] transition-colors">
            <Upload size={20} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-secondary)]">Click to select an image</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              JPEG, PNG, WebP, GIF · Max {AVATAR_CONFIG.maxFileSizeLabel} · Square crop
            </span>
          </div>
          <input type="file" accept={AVATAR_CONFIG.allowedTypes.join(",")} className="hidden" onChange={handleFileSelect} />
        </label>
        {error && (
          <div className="text-[11px] text-[var(--status-error)] text-center">{error}</div>
        )}
        {currentAvatar && (
          <button onClick={onCancel} className="w-full text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            Keep current avatar
          </button>
        )}
      </div>
    );
  }

  // File selected — show crop UI
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">Crop your avatar</span>
        <button onClick={handleReset} className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <RotateCcw size={10} strokeWidth={1.75} />
          Reset
        </button>
      </div>

      {/* Crop canvas */}
      <div className="flex justify-center">
        <div
          className="relative rounded-lg overflow-hidden border border-[var(--border-subtle)]"
          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="cursor-move touch-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          {/* Grid overlay */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/10" />
            <div className="absolute right-1/3 top-0 bottom-0 w-px bg-white/10" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/10" />
            <div className="absolute bottom-1/3 left-0 right-0 h-px bg-white/10" />
          </div>
        </div>
      </div>

      {/* Zoom slider */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">Zoom</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.1"
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="flex-1 h-1 rounded-full bg-[var(--surface-raised)] appearance-none cursor-pointer accent-[var(--accent)]"
        />
        <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right">{zoom.toFixed(1)}x</span>
      </div>

      {error && (
        <div className="text-[11px] text-[var(--status-error)] text-center">{error}</div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSelectedFile(null); setImageUrl(null); setError(null); }}
          className="flex-1 h-8 gap-1.5 text-xs"
        >
          <X size={12} strokeWidth={1.75} />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleApply}
          disabled={uploading}
          className="flex-1 h-8 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-xs"
        >
          {uploading ? (
            <>
              <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Check size={12} strokeWidth={2} />
              Apply
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
