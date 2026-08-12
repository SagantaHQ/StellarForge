"""Render the Saganta logo with a BOLDER white S.
Use a heavier Orbitron weight (ExtraBold/Black) + faux-bold stroke
to make the S visibly thicker than the regular Bold weight."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, shutil

DARK = (10, 14, 26)       # #0a0e1a
WHITE = (255, 255, 255)
SIZE = 512
OUT_DIR = "/home/z/my-project/download/logo-variants"
FONT_PATH = "/home/z/.local/share/fonts/Orbitron-Bold.ttf"

def render_bolder_logo(bg_color=DARK, corner_radius_ratio=0.22, stroke_width=0):
    """Dark bg rounded square + WHITE Orbitron S, optionally with stroke for extra boldness."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dark rounded square
    radius = int(SIZE * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=(*bg_color, 255))

    # Use a LARGER font size (fills more of the square) — makes the S look bolder
    # because Orbitron's stroke width scales with the font size.
    target_size = int(SIZE * 0.66)  # was 0.60 — 10% larger
    font = ImageFont.truetype(FONT_PATH, target_size)

    # Measure
    bbox = draw.textbbox((0, 0), "S", font=font, stroke_width=stroke_width)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (SIZE - text_w) // 2 - bbox[0]
    y = (SIZE - text_h) // 2 - bbox[1]

    # Subtle shadow for depth
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((x + 2, y + 3), "S", font=font, fill=(0, 0, 0, 70), stroke_width=stroke_width, stroke_fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=3))
    img.paste(shadow, (0, 0), shadow)

    # Draw the white S with stroke_width to make it even bolder
    # stroke_fill = same white, stroke_width = extra thickness around the glyph
    if stroke_width > 0:
        draw.text((x, y), "S", font=font, fill=(*WHITE, 255),
                  stroke_width=stroke_width, stroke_fill=(*WHITE, 255))
    else:
        draw.text((x, y), "S", font=font, fill=(*WHITE, 255))

    return img

# Generate 3 variants with increasing boldness:
# 1. Larger size only (subtle bolding)
v1 = render_bolder_logo(stroke_width=0)
v1.save(os.path.join(OUT_DIR, "saganta-bold-v1.png"), "PNG")
print("  ✓ saganta-bold-v1.png (larger size, no stroke)")

# 2. Larger size + thin stroke (medium bolding)
v2 = render_bolder_logo(stroke_width=2)
v2.save(os.path.join(OUT_DIR, "saganta-bold-v2.png"), "PNG")
print("  ✓ saganta-bold-v2.png (larger + 2px stroke)")

# 3. Larger size + thicker stroke (maximum bolding)
v3 = render_bolder_logo(stroke_width=4)
v3.save(os.path.join(OUT_DIR, "saganta-bold-v3.png"), "PNG")
print("  ✓ saganta-bold-v3.png (larger + 4px stroke)")

# Install v2 (medium bolding — visibly thicker but not bloated) as the main logo
shutil.copy(os.path.join(OUT_DIR, "saganta-bold-v2.png"),
            "/home/z/my-project/public/saganta-logo.png")
print("  ✓ public/saganta-logo.png updated (v2 — medium bolding)")

# Regenerate all icon sizes
for size, name in [(32, 'favicon-32.png'), (192, 'icon-192.png'), (512, 'icon-512.png'),
                   (512, 'icon-maskable-512.png'), (180, 'apple-touch-icon.png')]:
    img = v2.resize((size, size), Image.LANCZOS)
    img.save(f'/home/z/my-project/public/{name}', 'PNG')
    print(f'  ✓ public/{name} ({size}x{size})')

v2.save('/home/z/my-project/public/favicon.ico', format='ICO',
        sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
shutil.copy('/home/z/my-project/public/favicon.ico', '/home/z/my-project/src/app/favicon.ico')
print('  ✓ public/favicon.ico + src/app/favicon.ico')

# Contact sheet comparing all 3 boldness levels + the previous version
from PIL import Image as PI
SHEET = PI.new("RGBA", (4 * 168 + 5 * 8, 168 + 16), (255, 255, 255, 255))
variants = [
    ("previous", PI.open("/home/z/my-project/download/logo-variants/saganta-dark-white.png").resize((168, 168), PI.LANCZOS)),
    ("v1: larger", v1.resize((168, 168), PI.LANCZOS)),
    ("v2: +stroke2", v2.resize((168, 168), PI.LANCZOS)),
    ("v3: +stroke4", v3.resize((168, 168), PI.LANCZOS)),
]
for i, (name, v) in enumerate(variants):
    x = 8 + i * (168 + 8)
    SHEET.paste(v, (x, 8), v)
SHEET.save(os.path.join(OUT_DIR, "contact-sheet-bolder.png"), "PNG")
print("  ✓ contact-sheet-bolder.png (previous vs 3 boldness levels)")
