"""Stitch viewport screenshots into one tall image. Args: out total_css_height part.png:css_top ..."""
import sys
from PIL import Image

out, total, parts = sys.argv[1], int(sys.argv[2]), [p.rsplit(":", 1) for p in sys.argv[3:]]
first = Image.open(parts[0][0])
scale = 1
canvas = Image.new("RGB", (first.width, total * scale))
for f, top in parts:
    canvas.paste(Image.open(f).convert("RGB"), (0, int(top) * scale))
canvas.save(out, optimize=True)
