"""Step 5: download every daily file for the shortlisted locations and reduce to an hourly PM2.5
series per location (UTC). One .npz per location under data/raw_hourly/ acts as the resume cache.

Per location we keep: hourly sum and count of valid PM2.5 values, plus counts of dropped rows.
OpenAQ timestamps are kept as published (hour label = floor of the UTC timestamp)."""
import asyncio, gzip, json, sys, time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from .s3 import session, list_prefix, get, BUCKET
from .regions import MONTHS, START

OUT = Path("data/raw_hourly"); OUT.mkdir(parents=True, exist_ok=True)
T0 = datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp()
NH = 730 * 24


def parse(raw, s, n, stats):
    try:
        text = gzip.decompress(raw).decode("utf-8")
    except Exception:
        stats["bad_files"] += 1
        return
    for line in text.splitlines()[1:]:
        if '"pm25"' not in line:
            continue
        p = line.rsplit(",", 6)  # ..., datetime, lat, lon, parameter, units, value
        try:
            v = float(p[-1].strip('"'))
            ts = datetime.fromisoformat(p[-6].strip('"')).timestamp()
        except Exception:
            stats["unparsed"] += 1
            continue
        stats["rows"] += 1
        if not np.isfinite(v) or v < 0:
            stats["negative"] += 1
            continue
        if v > 2000:  # beyond any physical ambient hourly PM2.5; treated as an error code
            stats["over_2000"] += 1
            continue
        h = int((ts - T0) // 3600)
        if 0 <= h < NH:
            s[h] += v; n[h] += 1


async def one(sess, sem, i):
    f = OUT / f"{i}.npz"
    if f.exists():
        return
    s, n = np.zeros(NH, np.float64), np.zeros(NH, np.int32)
    stats = dict(rows=0, negative=0, over_2000=0, unparsed=0, bad_files=0, files=0)
    keys = []
    async with sem:
        for y, m in MONTHS:
            k, _ = await list_prefix(sess, f"records/csv.gz/locationid={i}/year={y}/month={m:02d}/")
            keys += [key for key, _ in k]
    async def fetch(key):
        async with sem:
            raw = await get(sess, f"{BUCKET}/{key}", binary=True)
        if raw:
            stats["files"] += 1
            parse(raw, s, n, stats)
    await asyncio.gather(*[fetch(k) for k in keys])
    np.savez_compressed(f, sum=s, n=n, stats=json.dumps(stats))


async def main(part, nparts):
    ids = [c["id"] for c in json.loads(Path("data/discover/shortlist.json").read_text())][part::nparts]
    t0 = time.time()
    async with session(100) as sess:
        sem = asyncio.Semaphore(100)
        for j in range(0, len(ids), 12):
            await asyncio.gather(*[one(sess, sem, i) for i in ids[j:j + 12]])
            print(f"part {part}: {min(j+12,len(ids))}/{len(ids)} {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]), int(sys.argv[2])))
