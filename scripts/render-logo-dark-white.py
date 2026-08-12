"""Render the Saganta logo: dark bg + WHITE Orbitron Bold S.
White S blends with all themes (light, dark, midnight, etc.)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, shutil

# Brand colors
DARK = (10, 14, 26)          # #0a0e1a — dark navy
WHITE = (255, 255, 255)      # white S

SIZE = 512
OUT_DIR = "/home/z/my-project/download/logo-variants"
FONT_PATH = "/home/z/.local/share/fonts/Orbitron-Bold.ttf"

def render_dark_white_logo(bg_color=DARK, corner_radius_ratio=0.22, with_glow=False, with_shadow=True):
    """Dark bg rounded square + WHITE Orbitron S."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dark rounded square
    radius = int(SIZE * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=(*bg_color, 255))

    # Optional subtle white glow behind the S
    if with_glow:
        glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        cx, cy = SIZE // 2, SIZE // 2
        for r in range(int(SIZE * 0.42), 0, -3):
            t = r / (SIZE * 0.42)
            alpha = int(30 * (1 - t) ** 1.5)
            glow_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*WHITE, alpha))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=10))
        img.paste(glow, (0, 0), glow)

    # Render white S
    target_size = int(SIZE * 0.60)
    font = ImageFont.truetype(FONT_PATH, target_size)
    bbox = draw.textbbox((0, 0), "S", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (SIZE - text_w) // 2 - bbox[0]
    y = (SIZE - text_h) // 2 - bbox[1]

    # Subtle shadow for depth (only if enabled)
    if with_shadow:
        shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.text((x + 2, y + 3), "S", font=font, fill=(0, 0, 0, 60))
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=3))
        img.paste(shadow, (0, 0), shadow)

    # White S
    draw.text((x, y), "S", font=font, fill=(*WHITE, 255))
    return img

# Main version: dark navy + white S + subtle shadow (no glow — cleanest)
logo = render_dark_white_logo(bg_color=DARK, with_glow=False, with_shadow=True)
logo.save(os.path.join(OUT_DIR, "saganta-dark-white.png"), "PNG")
print("  ✓ saganta-dark-white.png (dark navy + white S)")

# Install as the main logo + all app icons
shutil.copy(os.path.join(OUT_DIR, "saganta-dark-white.png"),
            "/home/z/my-project/public/saganta-logo.png")
print("  ✓ public/saganta-logo.png updated")

for size, name in [(32, 'favicon-32.png'), (192, 'icon-192.png'), (512, 'icon-512.png'),
                   (512, 'icon-maskable-512.png'), (180, 'apple-touch-icon.png')]:
    img = logo.resize((size, size), Image.LANCZOS)
    img.save(f'/home/z/my-project/public/{name}', 'PNG')
    print(f'  ✓ public/{name} ({size}x{size})')

logo.save('/home/z/my-project/public/favicon.ico', format='ICO',
          sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
shutil.copy('/home/z/my-project/public/favicon.ico', '/home/z/my-project/src/app/favicon.ico')
print('  ✓ public/favicon.ico + src/app/favicon.ico')
