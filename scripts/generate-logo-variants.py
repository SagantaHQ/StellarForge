"""
Generate logo background variants for saganta.png.

Brand colors detected from the logo:
  - Primary:   #30d090 (vibrant green)
  - Secondary: #f0f0f0 (off-white)

Variants generated:
  1. solid-brand       — solid #30d090 background
  2. solid-dark        — dark navy (#0a0e1a) background (green pops)
  3. solid-white       — pure white background
  4. gradient-brand    — diagonal gradient #30d090 → #1ea070 (depth)
  5. gradient-dark     — diagonal gradient #0a0e1a → #142a26 (subtle green tint)
  6. badge-circle      — circular badge with brand green background
  7. badge-rounded     — rounded square (iOS-style) with brand green
  8. glow-dark         — dark bg with green radial glow behind logo
"""

from PIL import Image, ImageDraw, ImageFilter
import os

SRC = "/home/z/my-project/upload/saganta.png"
OUT_DIR = "/home/z/my-project/download/logo-variants"
os.makedirs(OUT_DIR, exist_ok=True)

# Brand colors
BRAND = (48, 208, 144, 255)       # #30d090
BRAND_DARK = (30, 160, 112, 255)  # #1ea070
DARK = (10, 14, 26, 255)          # #0a0e1a
DARK_GREEN_TINT = (20, 42, 38, 255)  # #142a26
WHITE = (255, 255, 255, 255)

# Load logo (RGBA)
logo = Image.open(SRC).convert("RGBA")
W, H = logo.size

def make_bg_solid(color):
    return Image.new("RGBA", (W, H), color)

def make_bg_gradient(c1, c2, direction="diagonal"):
    """Linear gradient from c1 to c2."""
    bg = Image.new("RGBA", (W, H))
    px = bg.load()
    for y in range(H):
        for x in range(W):
            if direction == "diagonal":
                t = (x + y) / (W + H - 2)
            elif direction == "vertical":
                t = y / (H - 1)
            elif direction == "horizontal":
                t = x / (W - 1)
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b, 255)
    return bg

def make_bg_radial_glow(center_color, edge_color, glow_radius=0.45):
    """Radial gradient — center_color in middle, fading to edge_color."""
    bg = Image.new("RGBA", (W, H), edge_color)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    cx, cy = W // 2, H // 2
    max_r = int(min(W, H) * glow_radius)
    # Draw concentric circles with decreasing alpha
    for r in range(max_r, 0, -2):
        t = r / max_r
        alpha = int(180 * (1 - t) ** 1.8)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*center_color[:3], alpha))
    # Slight blur for smoothness
    glow = glow.filter(ImageFilter.GaussianBlur(radius=8))
    bg.paste(glow, (0, 0), glow)
    return bg

def make_badge_circle(bg_color, logo_scale=0.72):
    """Circular badge — logo centered on a solid color circle."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Draw circle
    draw.ellipse([0, 0, W - 1, H - 1], fill=bg_color)
    # Scale + center logo
    new_size = int(W * logo_scale)
    logo_scaled = logo.resize((new_size, new_size), Image.LANCZOS)
    offset = (W - new_size) // 2
    img.paste(logo_scaled, (offset, offset), logo_scaled)
    return img

def make_badge_rounded(bg_color, radius_ratio=0.22, logo_scale=0.72):
    """Rounded-square badge (iOS-style)."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(W * radius_ratio)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=radius, fill=bg_color)
    new_size = int(W * logo_scale)
    logo_scaled = logo.resize((new_size, new_size), Image.LANCZOS)
    offset = (W - new_size) // 2
    img.paste(logo_scaled, (offset, offset), logo_scaled)
    return img

def compose(bg, logo_img, logo_scale=1.0):
    """Paste logo (optionally scaled) centered on bg."""
    if logo_scale != 1.0:
        new_size = int(W * logo_scale)
        logo_scaled = logo_img.resize((new_size, new_size), Image.LANCZOS)
    else:
        logo_scaled = logo_img
    out = bg.copy()
    offset = ((W - logo_scaled.size[0]) // 2, (H - logo_scaled.size[1]) // 2)
    out.paste(logo_scaled, offset, logo_scaled)
    return out

# Generate variants
variants = []

# 1. Solid brand green
variants.append(("01-solid-brand.png", compose(make_bg_solid(BRAND), logo)))

# 2. Solid dark — green pops
variants.append(("02-solid-dark.png", compose(make_bg_solid(DARK), logo)))

# 3. Solid white
variants.append(("03-solid-white.png", compose(make_bg_solid(WHITE), logo)))

# 4. Gradient brand (diagonal, lighter to darker green)
variants.append(("04-gradient-brand.png", compose(make_bg_gradient(BRAND, BRAND_DARK, "diagonal"), logo)))

# 5. Gradient dark (navy to dark green tint)
variants.append(("05-gradient-dark.png", compose(make_bg_gradient(DARK, DARK_GREEN_TINT, "diagonal"), logo)))

# 6. Badge — circle, brand green bg
variants.append(("06-badge-circle-brand.png", make_badge_circle(BRAND)))

# 7. Badge — rounded square, brand green bg
variants.append(("07-badge-rounded-brand.png", make_badge_rounded(BRAND)))

# 8. Glow on dark — green radial glow behind logo
variants.append(("08-glow-dark.png", compose(make_bg_radial_glow(BRAND, DARK, glow_radius=0.5), logo)))

# 9. Badge circle on dark (logo on dark circle, transparent corners) — for light UIs
variants.append(("09-badge-circle-dark.png", make_badge_circle(DARK)))

# 10. Gradient brand vertical (top lighter, bottom darker) — subtle depth
variants.append(("10-gradient-brand-vertical.png", compose(make_bg_gradient(BRAND, BRAND_DARK, "vertical"), logo)))

# Save all
for name, img in variants:
    out_path = os.path.join(OUT_DIR, name)
    img.save(out_path, "PNG")
    print(f"  ✓ {name}")

# Also save a contact sheet (grid of all variants) for easy preview
COLS = 4
ROWS = (len(variants) + COLS - 1) // COLS
CELL = 160
SHEET = Image.new("RGBA", (COLS * CELL + (COLS + 1) * 8, ROWS * CELL + (ROWS + 1) * 8), (255, 255, 255, 255))
for i, (name, img) in enumerate(variants):
    row, col = i // COLS, i % COLS
    thumb = img.resize((CELL, CELL), Image.LANCZOS)
    x = 8 + col * (CELL + 8)
    y = 8 + row * (CELL + 8)
    SHEET.paste(thumb, (x, y), thumb)
sheet_path = os.path.join(OUT_DIR, "contact-sheet.png")
SHEET.save(sheet_path, "PNG")
print(f"\n  ✓ contact-sheet.png  ({len(variants)} variants in a grid)")

print(f"\nAll {len(variants)} variants saved to: {OUT_DIR}")
