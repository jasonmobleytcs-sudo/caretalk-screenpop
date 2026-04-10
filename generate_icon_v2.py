from PIL import Image, ImageDraw
import math

def draw_rounded_rect(draw, bbox, radius, fill):
    x1, y1, x2, y2 = bbox
    r = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)
    if r < 1:
        draw.rectangle(bbox, fill=fill)
        return
    draw.rectangle([x1 + r, y1, x2 - r, y2], fill=fill)
    draw.rectangle([x1, y1 + r, x2, y2 - r], fill=fill)
    draw.ellipse([x1, y1, x1 + r*2, y1 + r*2], fill=fill)
    draw.ellipse([x2 - r*2, y1, x2, y1 + r*2], fill=fill)
    draw.ellipse([x1, y2 - r*2, x1 + r*2, y2], fill=fill)
    draw.ellipse([x2 - r*2, y2 - r*2, x2, y2], fill=fill)

def create_icon(size, bg_color, fg_color, popup_color, filename):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = size
    pad = int(s * 0.04)

    # Background rounded square
    r = int(s * 0.22)
    draw_rounded_rect(draw, [pad, pad, s - pad, s - pad], r, bg_color)

    # --- Person / head icon ---
    cx = int(s * 0.38)
    cy = int(s * 0.58)

    # Head circle
    hr = int(s * 0.13)
    head_top = int(cy - s * 0.30)
    draw.ellipse([cx - hr, head_top, cx + hr, head_top + hr * 2], fill=fg_color)

    # Shoulders (clipped arc shape)
    sw = int(s * 0.28)
    sh = int(s * 0.18)
    sy = int(cy - s * 0.02)
    draw_rounded_rect(draw, [cx - sw, sy, cx + sw, sy + sh], int(sw * 0.9), fg_color)
    # Clip bottom of shoulders to not overflow bg
    draw.rectangle([cx - sw - 2, sy + sh - int(sh*0.3), cx + sw + 2, s], fill=bg_color)

    # --- Screenpop window (top right) ---
    wx1 = int(s * 0.50)
    wy1 = int(s * 0.12)
    wx2 = int(s * 0.88)
    wy2 = int(s * 0.46)
    wr = int(s * 0.05)

    # Window shadow/depth
    draw_rounded_rect(draw, [wx1+3, wy1+3, wx2+3, wy2+3], wr, (*popup_color[:3], 60))

    # Window body
    draw_rounded_rect(draw, [wx1, wy1, wx2, wy2], wr, popup_color)

    # Title bar
    bar_h = int(s * 0.07)
    draw_rounded_rect(draw, [wx1, wy1, wx2, wy1 + bar_h], wr, fg_color)
    draw.rectangle([wx1, wy1 + bar_h//2, wx2, wy1 + bar_h], fill=fg_color)

    # Content lines in window
    lx1 = wx1 + int(s * 0.04)
    lx2 = wx2 - int(s * 0.04)
    line_y = wy1 + bar_h + int(s * 0.035)
    line_h = int(s * 0.025)
    line_gap = int(s * 0.042)
    line_color = (*fg_color[:3], 120)

    for i in range(3):
        lw = lx2 if i < 2 else int(lx1 + (lx2 - lx1) * 0.6)
        draw_rounded_rect(draw, [lx1, line_y, lw, line_y + line_h], line_h // 2, line_color)
        line_y += line_gap

    # Arrow from person to popup (small triangle pointer)
    ax = int(s * 0.50)
    ay = int(s * 0.37)
    arrow_size = int(s * 0.055)
    draw.polygon([
        (ax, ay),
        (ax - arrow_size, ay - arrow_size // 2),
        (ax - arrow_size, ay + arrow_size // 2)
    ], fill=fg_color)

    return img

SIZE = 1024
BLUE = (35, 114, 235, 255)
DARK_BG = (30, 32, 48, 255)

# Light mode: blue bg, white icon, white popup
light = create_icon(SIZE, BLUE, (255, 255, 255, 255), (255, 255, 255, 220), 'app_icon_light.png')
light.save('app_icon_light.png')

# Dark mode: dark bg, blue accent, light popup
dark = create_icon(SIZE, DARK_BG, (255, 255, 255, 255), (35, 114, 235, 255), 'app_icon_dark.png')
dark.save('app_icon_dark.png')

# Also save 512 versions
light.resize((512, 512), Image.LANCZOS).save('app_icon_light_512.png')
dark.resize((512, 512), Image.LANCZOS).save('app_icon_dark_512.png')

print("Done: app_icon_light.png, app_icon_dark.png (1024px)")
print("      app_icon_light_512.png, app_icon_dark_512.png (512px)")
