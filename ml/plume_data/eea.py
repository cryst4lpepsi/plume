"""European Environment Agency hourly PM2.5, straight from the Air Quality Download Service.

OpenAQ carries only part of the EEA feed (Italy, Spain, Czechia and Sweden are close to empty there), so
Europe is also read from the source. Two datasets are joined per sampling point: verified data (E1a, to the
end of 2025) and up-to-date data (E2a, 2026 onwards). No key is needed.

python -m plume_data.eea  ->  data/raw_hourly_eea/{sampling point}.npz (resume cache, same layout as
data/raw_hourly/) and data/discover/eea_candidates.json (same fields as the OpenAQ shortlist, plus station
type and area)."""
import asyncio, io, json, time, zipfile, zlib
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
from .files import atomic
from .regions import START, region_of
from .s3 import session, get

API = "https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls"
META = "https://discomap.eea.europa.eu/App/AQViewer/download?fqn=Airquality_Dissem.b2g.measurements&f=csv"
DATASETS = (2, 1)          # 2 = verified (E1a), 1 = up-to-date (E2a)
OUT, DISC = Path("data/raw_hourly_eea"), Path("data/discover")
T0 = np.datetime64(datetime.fromisoformat(START), "h")
NH = 730 * 24


def reduce(frames):
    """Hourly sum and count over the study period from one sampling point's parquet frames."""
    s, n = np.zeros(NH, np.float64), np.zeros(NH, np.int32)
    stats = dict(rows=0, negative=0, over_2000=0, unparsed=0, bad_files=0, files=len(frames), invalid=0)
    for d in frames:
        d = d[d["AggType"] == "hour"]
        # hour label = End, as published: that is the label OpenAQ gives the same measurement, checked
        # value for value on stations present in both (DECISIONS.md)
        h = (d["End"].to_numpy().astype("datetime64[h]") - T0).astype(np.int64)
        v = pd.to_numeric(d["Value"], errors="coerce").to_numpy(np.float64)
        ok = (h >= 0) & (h < NH)
        h, v, valid = h[ok], v[ok], d["Validity"].to_numpy()[ok]
        stats["rows"] += int(ok.sum())
        flagged = valid < 1                       # -99 maintenance, -1 invalid; 1 to 3 are valid
        stats["invalid"] += int(flagged.sum())
        neg = ~flagged & (~np.isfinite(v) | (v < 0))
        over = ~flagged & ~neg & (v > 2000)
        stats["negative"] += int(neg.sum()); stats["over_2000"] += int(over.sum())
        keep = ~flagged & ~neg & ~over
        np.add.at(s, h[keep], v[keep]); np.add.at(n, h[keep], 1)
    return s, n, stats


async def one(sess, sem, key, urls):
    f = OUT / f"{key}.npz"
    if f.exists():
        return
    frames, bad = [], 0
    for u in urls:
        async with sem:
            raw = await get(sess, u, binary=True)
        if not raw:
            continue
        try:
            frames.append(pd.read_parquet(io.BytesIO(raw), columns=["End", "Value", "AggType", "Validity"]))
        except Exception:
            bad += 1
    s, n, stats = reduce(frames)
    stats["bad_files"] = bad
    atomic(f, lambda fh: np.savez_compressed(fh, sum=s, n=n, stats=json.dumps(stats)))


async def urls_by_point(sess):
    by, iso = defaultdict(list), {}
    for ds in DATASETS:
        body = {"countries": [], "cities": [], "pollutants": ["PM2.5"], "dataset": ds, "source": "API"}
        async with sess.post(API, json=body) as r:
            text = await r.text(encoding="utf-8-sig")
        for u in text.split()[1:]:
            k = u.rsplit("/", 1)[1].removesuffix(".parquet")
            by[k].append(u); iso[k] = u.rsplit("/", 2)[1]
    return by, iso


def station_id(key):
    """Stable integer id for a sampling point, clear of the OpenAQ location id range."""
    return 1_000_000_000 + zlib.crc32(key.encode()) % 1_000_000_000


def norm(point):
    """Sampling point ids differ in punctuation between the metadata and the file names."""
    return "".join(ch for ch in point.split("/")[-1].upper() if ch.isalnum())


async def metadata(sess, keys, iso):
    raw = await get(sess, META, binary=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        d = pd.read_csv(z.open(z.namelist()[0]), low_memory=False, usecols=[
            "Sampling Point Id", "Air Pollutant", "Longitude", "Latitude", "Altitude", "Year",
            "Air Quality Station EoI Code", "Air Quality Station Name", "Air Quality Station Area",
            "Air Quality Station Type", "Measurement Type"])
    d = d[d["Air Pollutant"] == "PM2.5"].sort_values("Year").drop_duplicates("Sampling Point Id", keep="last")
    look = {norm(p): r for p, r in zip(d["Sampling Point Id"], d.to_dict("records"))}
    out = {}
    for k in keys:
        r = look.get(norm(k))
        if r is None or not np.isfinite(r["Latitude"]) or not np.isfinite(r["Longitude"]):
            continue
        lat, lon = float(r["Latitude"]), float(r["Longitude"])
        if region_of(lat, lon) != "europe":
            continue
        out[k] = dict(id=station_id(k), region="europe", iso=iso[k], lat=lat, lon=lon, cov=None,
                      name=str(r["Air Quality Station Name"]), src="eea", key=k,
                      eoi=str(r["Air Quality Station EoI Code"]), area=str(r["Air Quality Station Area"]),
                      type=str(r["Air Quality Station Type"]))
    assert len({c["id"] for c in out.values()}) == len(out), "sampling point id collision"
    return out


async def main():
    OUT.mkdir(parents=True, exist_ok=True); DISC.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    async with session(24) as sess:
        by, iso = await urls_by_point(sess)
        meta = await metadata(sess, by, iso)
        (DISC / "eea_candidates.json").write_text(json.dumps(list(meta.values()), ensure_ascii=False), encoding="utf-8")
        print(len(by), "sampling points,", len(meta), "with coordinates in the Europe box", flush=True)
        keys = sorted(meta)
        sem = asyncio.Semaphore(24)
        for j in range(0, len(keys), 48):
            await asyncio.gather(*[one(sess, sem, k, by[k]) for k in keys[j:j + 48]])
            print(f"eea: {min(j + 48, len(keys))}/{len(keys)} {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
