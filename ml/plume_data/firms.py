"""Active fires from NASA FIRMS (VIIRS on NOAA-21), reduced to a smoke-source feature per station.

One satellite and one processing stream cover the whole study period, so the feature means the same thing in
training and in the test months. The area API needs a free key (https://firms.modaps.eosdis.nasa.gov/api/map_key/)
in FIRMS_MAP_KEY; without it this step is skipped and the fire features are zero.

python -m plume_data.firms  ->  data/firms/{region}/{date}.csv (resume cache, 5 days each) and
data/firms/{region}.npz (fire radiative power summed per hour and 0.1 degree cell)."""
import asyncio, os, time
from datetime import date, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import sparse
from scipy.spatial import cKDTree
from .files import atomic
from .regions import REGIONS, START
from .s3 import session, get

SOURCE = "VIIRS_NOAA21_NRT"
API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
OUT = Path("data/firms")
T0 = np.datetime64(START, "h")
NH = 730 * 24
DAYS, CELL = 5, 0.1        # days per request (the API maximum); grid the detections are summed on
RADII_KM = (100.0, 300.0)  # local fires, and regional smoke
WINDOW = 24                # hours of detections that count at each hour
MARGIN_DEG = 3.0           # fires just outside the region box still reach stations near its edge
COLS = ["latitude", "longitude", "acq_date", "acq_time", "confidence", "frp"]


def chunks():
    """Request start dates: from one day before the period (the first window looks back) to its end."""
    d = date.fromisoformat(START[:10]) - timedelta(days=1)
    end = date.fromisoformat(START[:10]) + timedelta(days=NH // 24)
    while d < end:
        yield d.isoformat()
        d += timedelta(days=DAYS)


async def fetch(sess, sem, key, region, day):
    f = OUT / region / f"{day}.csv"
    if f.exists():
        return
    r = REGIONS[region]
    box = f"{r['lon'][0] - MARGIN_DEG},{r['lat'][0] - MARGIN_DEG},{r['lon'][1] + MARGIN_DEG},{r['lat'][1] + MARGIN_DEG}"
    for i in range(12):
        try:
            async with sem:
                text = await get(sess, f"{API}/{key}/{SOURCE}/{box}/{DAYS}/{day}", tries=1)
        except Exception as e:   # over the limit the API answers HTTP 400 "Invalid MAP_KEY"
            text = str(e)
        if text and text.startswith("latitude,longitude"):
            atomic(f, lambda fh: fh.write(text.encode("utf-8")))
            return
        await asyncio.sleep(120)   # the key allows 5,000 transactions per 10 minutes; wait for the window to move
    raise RuntimeError(f"FIRMS {region} {day}: {(text or '')[:200]}")


def reduce(frames):
    """Detections -> (hour index, cell lat, cell lon, summed FRP in MW). Low-confidence detections are dropped."""
    d = pd.concat(frames, ignore_index=True)
    d = d[(d["confidence"] != "l") & (d["frp"] > 0)]
    t = (pd.to_datetime(d["acq_date"]).to_numpy().astype("datetime64[h]")
         + (d["acq_time"].to_numpy(np.int64) // 100).astype("timedelta64[h]"))
    h = (t - T0).astype(np.int64)
    ok = (h >= -WINDOW) & (h < NH)
    g = pd.DataFrame(dict(h=h[ok], i=np.floor(d["latitude"].to_numpy()[ok] / CELL).astype(np.int64),
                          j=np.floor(d["longitude"].to_numpy()[ok] / CELL).astype(np.int64), frp=d["frp"].to_numpy()[ok]))
    g = g.groupby(["h", "i", "j"], as_index=False)["frp"].sum()
    return (g["h"].to_numpy(np.int32), ((g["i"] + 0.5) * CELL).to_numpy(np.float32),
            ((g["j"] + 0.5) * CELL).to_numpy(np.float32), g["frp"].to_numpy(np.float32))


def xyz(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def fire_load(h, lat, lon, frp, st_lat, st_lon, radii=RADII_KM, nh=NH, window=WINDOW):
    """[nh, stations, len(radii)]: FRP (MW) detected within each radius of a station during the `window`
    hours ending at each hour. Only detections at or before the hour count, so nothing leaks from the future."""
    out = np.zeros((nh, len(st_lat), len(radii)), np.float32)
    if len(h) == 0:
        return out
    cells, inv = np.unique(np.stack([lat, lon], 1), axis=0, return_inverse=True)
    by_hour = sparse.csr_matrix((frp.astype(np.float64), (h.astype(np.int64) + window, inv.ravel())),
                                shape=(nh + window, len(cells)))
    tree, pts = cKDTree(xyz(np.asarray(st_lat), np.asarray(st_lon))), xyz(cells[:, 0], cells[:, 1])
    for k, km in enumerate(radii):
        near = tree.query_ball_point(pts, 2 * np.sin(km / 6371.0088 / 2))
        rows = np.repeat(np.arange(len(cells)), [len(x) for x in near])
        cols = np.fromiter((s for x in near for s in x), np.int64, len(rows))
        reach = sparse.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(cells), len(st_lat)))
        c = np.cumsum(np.vstack([np.zeros((1, len(st_lat))), (by_hour @ reach).toarray()]), 0)
        out[:, :, k] = c[window + 1:] - c[1:nh + 1]
    return out


def load(region):
    """Reduced detections for a region, or None when the fires were not downloaded."""
    f = OUT / f"{region}.npz"
    if not f.exists():
        return None
    z = np.load(f)
    return z["h"], z["lat"], z["lon"], z["frp"]


async def main():
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        print("firms: FIRMS_MAP_KEY is not set, skipping. Fire features will be zero.", flush=True)
        return
    t0, days = time.time(), list(chunks())
    async with session(4) as sess:
        sem = asyncio.Semaphore(3)
        for region in REGIONS:
            (OUT / region).mkdir(parents=True, exist_ok=True)
            for j in range(0, len(days), 6):
                await asyncio.gather(*[fetch(sess, sem, key, region, d) for d in days[j:j + 6]])
                print(f"firms {region}: {min(j + 6, len(days))}/{len(days)} {time.time() - t0:.0f}s", flush=True)
            frames = [pd.read_csv(OUT / region / f"{d}.csv", usecols=COLS) for d in days]
            h, lat, lon, frp = reduce(frames)
            np.savez_compressed(OUT / f"{region}.npz", h=h, lat=lat, lon=lon, frp=frp)
            print(f"firms {region}: {sum(len(f) for f in frames)} detections -> {len(h)} cell-hours", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
