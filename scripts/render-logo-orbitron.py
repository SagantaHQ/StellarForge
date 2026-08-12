"""
Regenerate the saganta logo with the Orbitron font (bold) for the S.

Reads the original logo, extracts the brand color, renders a new "S" using
Orbitron Bold, composites it onto the brand green rounded-square background.

Outputs:
  - saganta-orbitron.png          (512x512, transparent corners, matches original)
  - saganta-orbitron-dark.png     (on dark bg)
  - saganta-orbitron-brand.png    (on solid brand green bg)
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

# Brand colors (extracted from original logo)
BRAND = (48, 208, 144)       # #30d090
BRAND_DARK = (30, 160, 112)  # #1ea070
DARK = (10, 14, 26)          # #0a0e1a
WHITE = (255, 255, 255)

SIZE = 512
OUT_DIR = "/home/z/my-project/download/logo-variants"
os.makedirs(OUT_DIR, exist_ok=True)

# Load Orbitron Bold font
FONT_PATH = "/home/z/.local/share/fonts/Orbitron-Bold.ttf"

def render_logo_orbitron(bg_color=(0, 0, 0, 0), corner_radius_ratio=0.22):
    """Render the logo: brand green rounded square + white 'S' in Orbitron Bold."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # If bg_color is fully transparent (original style), draw the brand green
    # rounded square. If bg_color is opaque (dark/white), fill the whole canvas
    # then draw the brand green rounded square on top.
    if bg_color[3] == 255:
        draw.rectangle([0, 0, SIZE - 1, SIZE - 1], fill=bg_color)

    # Draw the brand green rounded square
    radius = int(SIZE * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=(*BRAND, 255))

    # Render "S" in Orbitron Bold, white, centered
    # Try increasingly large font sizes to find the best fit
    # The S should fill ~65% of the square
    target_size = int(SIZE * 0.62)
    font = ImageFont.truetype(FONT_PATH, target_size)

    # Measure the rendered "S" to center it precisely
    # Use the bounding box of the letter
    bbox = draw.textbbox((0, 0), "S", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Center the S — account for the bbox offset (some fonts have asymmetric padding)
    x = (SIZE - text_w) // 2 - bbox[0]
    y = (SIZE - text_h) // 2 - bbox[1]

    # Draw a subtle shadow for depth (optional, matches the original's slight depth)
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((x + 3, y + 4), "S", font=font, fill=(0, 80, 50, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=6))
    img.paste(shadow, (0, 0), shadow)

    # Draw the white S
    draw.text((x, y), "S", font=font, fill=(*WHITE, 255))

    return img


# 1. Original-style: transparent corners, brand green rounded square, white Orbitron S
logo = render_logo_orbitron(bg_color=(0, 0, 0, 0))
logo.save(os.path.join(OUT_DIR, "saganta-orbitron.png"), "PNG")
print("  ✓ saganta-orbitron.png (transparent corners, Orbitron Bold S)")

# 2. On dark background
logo_dark = render_logo_orbitron(bg_color=(*DARK, 255))
logo_dark.save(os.path.join(OUT_DIR, "saganta-orbitron-dark.png"), "PNG")
print("  ✓ saganta-orbitron-dark.png (dark bg, Orbitron Bold S)")

# 3. On solid brand green (fills transparent corners)
logo_brand = render_logo_orbitron(bg_color=(*BRAND, 255))
logo_brand.save(os.path.join(OUT_DIR, "saganta-orbitron-brand.png"), "PNG")
print("  ✓ saganta-orbitron-brand.png (solid brand green, Orbitron Bold S)")

# 4. Gradient brand background
def render_logo_gradient():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # Draw diagonal gradient
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2 * SIZE - 2)
            r = int(BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * t)
            g = int(BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * t)
            b = int(BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * t)
            px[x, y] = (r, g, b, 255)
    draw = ImageDraw.Draw(img)
    # Draw S
    target_size = int(SIZE * 0.62)
    font = ImageFont.truetype(FONT_PATH, target_size)
    bbox = draw.textbbox((0, 0), "S", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (SIZE - text_w) // 2 - bbox[0]
    y = (SIZE - text_h) // 2 - bbox[1]
    draw.text((x, y), "S", font=font, fill=(*WHITE, 255))
    return img

logo_grad = render_logo_gradient()
logo_grad.save(os.path.join(OUT_DIR, "saganta-orbitron-gradient.png"), "PNG")
print("  ✓ saganta-orbitron-gradient.png (gradient brand bg, Orbitron Bold S)")

# Also overwrite the contact sheet with the new variants
SHEET = Image.new("RGBA", (4 * 168 + 5 * 8, 1 * 168 + 2 * 8), (255, 255, 255, 255))
variants = [
    ("original", Image.open("/home/z/my-project/upload/saganta.png").convert("RGBA").resize((168, 168), Image.LANCZOS)),
    ("orbitron", logo.resize((168, 168), Image.LANCZOS)),
    ("orbitron-dark", logo_dark.resize((168, 168), Image.LANCZOS)),
    ("orbitron-grad", logo_grad.resize((168, 168), Image.LANCZOS)),
]
for i, (name, v) in enumerate(variants):
    x = 8 + i * (168 + 8)
    y = 8
    SHEET.paste(v, (x, y), v if v.mode == "RGBA" else None)
SHEET.save(os.path.join(OUT_DIR, "contact-sheet-orbitron.png"), "PNG")
print("  ✓ contact-sheet-orbitron.png (original vs orbitron variants)")

print(f"\nAll variants saved to: {OUT_DIR}")
