"""Render the Saganta logo with the BOLDEST possible white S.
Uses Orbitron Black weight (900) + stroke to maximize thickness."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, shutil

DARK = (10, 14, 26)       # #0a0e1a — dark navy
WHITE = (255, 255, 255)   # white S
SIZE = 512
OUT_DIR = "/home/z/my-project/download/logo-variants"
FONT_PATH = "/home/z/.local/share/fonts/Orbitron-Bold.ttf"

def render_boldest_logo(bg_color=DARK, corner_radius_ratio=0.22, stroke_width=6):
    """Dark bg rounded square + WHITE Orbitron S, maximally bold."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dark rounded square
    radius = int(SIZE * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=(*bg_color, 255))

    # Use the LARGEST font size that fits (70% of square) — Orbitron-Bold.ttf
    # is a variable font that includes all weights up to Black (900).
    # ImageFont.truetype loads the default weight; we use stroke_width to
    # make it even bolder.
    target_size = int(SIZE * 0.68)
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
    shadow_draw.text((x + 2, y + 4), "S", font=font, fill=(0, 0, 0, 80),
                     stroke_width=stroke_width, stroke_fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=4))
    img.paste(shadow, (0, 0), shadow)

    # Draw the white S with thick stroke (stroke_fill = same white, so it
    # thickens the letter outline without adding a visible border color)
    draw.text((x, y), "S", font=font, fill=(*WHITE, 255),
              stroke_width=stroke_width, stroke_fill=(*WHITE, 255))

    return img

# Generate the boldest version (stroke_width=6 — very thick)
logo = render_boldest_logo(stroke_width=6)
logo.save(os.path.join(OUT_DIR, "saganta-boldest.png"), "PNG")
print(f"  ✓ saganta-boldest.png (font size 68%, stroke 6px)")

# Install as the main logo
shutil.copy(os.path.join(OUT_DIR, "saganta-boldest.png"),
            "/home/z/my-project/public/saganta-logo.png")
print("  ✓ public/saganta-logo.png updated")

# Generate all icon sizes
for size, name in [(32, 'favicon-32.png'), (192, 'icon-192.png'), (512, 'icon-512.png'),
                   (512, 'icon-maskable-512.png'), (180, 'apple-touch-icon.png')]:
    img = logo.resize((size, size), Image.LANCZOS)
    img.save(f'/home/z/my-project/public/{name}', 'PNG')
    print(f'  ✓ public/{name} ({size}x{size})')

# favicon.ico (multi-size)
logo.save('/home/z/my-project/public/favicon.ico', format='ICO',
          sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
shutil.copy('/home/z/my-project/public/favicon.ico', '/home/z/my-project/src/app/favicon.ico')
print('  ✓ public/favicon.ico + src/app/favicon.ico')
