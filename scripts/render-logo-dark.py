"""Render the Saganta logo with a DARK background + Orbitron Bold S."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

# Brand colors
BRAND = (48, 208, 144)       # #30d090 — the green S
DARK = (10, 14, 26)          # #0a0e1a — dark navy
DARK_GREEN_TINT = (16, 28, 26)  # subtle green-tinted dark

SIZE = 512
OUT_DIR = "/home/z/my-project/download/logo-variants"
FONT_PATH = "/home/z/.local/share/fonts/Orbitron-Bold.ttf"

def render_dark_logo(bg_color, corner_radius_ratio=0.22, s_color=BRAND, with_glow=True):
    """Dark bg rounded square + green Orbitron S with optional glow."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw the dark rounded square
    radius = int(SIZE * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=(*bg_color, 255))

    # Optional green glow behind the S
    if with_glow:
        glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        # Draw a soft green circle behind the S
        cx, cy = SIZE // 2, SIZE // 2
        for r in range(int(SIZE * 0.42), 0, -3):
            t = r / (SIZE * 0.42)
            alpha = int(50 * (1 - t) ** 1.5)
            glow_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*BRAND, alpha))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=12))
        img.paste(glow, (0, 0), glow)

    # Render "S" in Orbitron Bold, brand green
    target_size = int(SIZE * 0.60)
    font = ImageFont.truetype(FONT_PATH, target_size)
    bbox = draw.textbbox((0, 0), "S", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (SIZE - text_w) // 2 - bbox[0]
    y = (SIZE - text_h) // 2 - bbox[1]

    # Subtle shadow for depth
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((x + 2, y + 3), "S", font=font, fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=4))
    img.paste(shadow, (0, 0), shadow)

    # The green S
    draw.text((x, y), "S", font=font, fill=(*s_color, 255))

    return img

# 1. Dark navy bg with green glow + green S
logo_dark_glow = render_dark_logo(DARK, with_glow=True)
logo_dark_glow.save(os.path.join(OUT_DIR, "saganta-dark-glow.png"), "PNG")
print("  ✓ saganta-dark-glow.png (dark navy + green glow + green S)")

# 2. Dark navy bg, no glow, green S (cleaner/minimal)
logo_dark_clean = render_dark_logo(DARK, with_glow=False)
logo_dark_clean.save(os.path.join(OUT_DIR, "saganta-dark-clean.png"), "PNG")
print("  ✓ saganta-dark-clean.png (dark navy + green S, no glow)")

# 3. Green-tinted dark bg + green S
logo_dark_tint = render_dark_logo(DARK_GREEN_TINT, with_glow=False)
logo_dark_tint.save(os.path.join(OUT_DIR, "saganta-dark-tint.png"), "PNG")
print("  ✓ saganta-dark-tint.png (green-tinted dark + green S)")

# 4. Pure black bg + green S
logo_black = render_dark_logo((0, 0, 0), with_glow=False)
logo_black.save(os.path.join(OUT_DIR, "saganta-black.png"), "PNG")
print("  ✓ saganta-black.png (pure black + green S)")

# Install the dark-glow version as the main logo + all app icons
import shutil
DARK_LOGO = logo_dark_glow

# Save as the main logo
shutil.copy(os.path.join(OUT_DIR, "saganta-dark-glow.png"),
            "/home/z/my-project/public/saganta-logo.png")
print("  ✓ public/saganta-logo.png (updated to dark-glow version)")

# Generate all icon sizes
for size, name in [(32, 'favicon-32.png'), (192, 'icon-192.png'), (512, 'icon-512.png'),
                   (512, 'icon-maskable-512.png'), (180, 'apple-touch-icon.png')]:
    img = DARK_LOGO.resize((size, size), Image.LANCZOS)
    img.save(f'/home/z/my-project/public/{name}', 'PNG')
    print(f'  ✓ public/{name} ({size}x{size})')

# favicon.ico
DARK_LOGO.save('/home/z/my-project/public/favicon.ico', format='ICO',
               sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
shutil.copy('/home/z/my-project/public/favicon.ico', '/home/z/my-project/src/app/favicon.ico')
print('  ✓ public/favicon.ico + src/app/favicon.ico')

# Contact sheet comparing all dark variants
SHEET = Image.new("RGBA", (4 * 168 + 5 * 8, 168 + 16), (255, 255, 255, 255))
variants = [
    ("dark-glow", logo_dark_glow),
    ("dark-clean", logo_dark_clean),
    ("dark-tint", logo_dark_tint),
    ("black", logo_black),
]
for i, (name, v) in enumerate(variants):
    thumb = v.resize((168, 168), Image.LANCZOS)
    x = 8 + i * (168 + 8)
    SHEET.paste(thumb, (x, 8), thumb)
SHEET.save(os.path.join(OUT_DIR, "contact-sheet-dark.png"), "PNG")
print("  ✓ contact-sheet-dark.png")
