"""Base-map assets for the globe: Natural Earth 1:50m coastline as int16 line segments.

File layout (little endian): uint32 n_segments, then n_segments * 4 int16 (lon0, lat0, lon1, lat1) in 0.01 degree."""
import struct
from pathlib import Path
import numpy as np
import shapefile


def main():
    sf = shapefile.Reader("data/geo/ne_50m_coastline/ne_50m_coastline.shp")
    segs = []
    for sh in sf.shapes():
        pts = np.array(sh.points)
        parts = list(sh.parts) + [len(pts)]
        for a, b in zip(parts[:-1], parts[1:]):
            p = np.rint(pts[a:b] * 100).astype(np.int32)
            keep = np.r_[True, np.any(np.diff(p, axis=0) != 0, 1)]
            p = p[keep]
            segs.append(np.concatenate([p[:-1], p[1:]], 1))
    segs = np.concatenate(segs).astype(np.int16)
    out = Path("web/public/data/coast.bin")
    out.write_bytes(struct.pack("<I", len(segs)) + segs.tobytes())
    print(len(segs), "segments", out.stat().st_size // 1024, "KB")

if __name__ == "__main__":
    main()
