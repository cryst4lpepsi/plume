"""Step 3b: second look at locations that failed the two-month probe.

India's CPCB feed has no files in the archive for Nov 2024 to Feb 2025, so every Indian station fails a
probe that includes January 2025. This pass lists each remaining location's 2025 files and reads one
mid-year file for coordinates. Writes data/discover/y2025_days.json and meta_extra.json."""
import asyncio, csv, gzip, io, json
from pathlib import Path
from .s3 import session, list_prefix, get, BUCKET

D = Path("data/discover")


async def main():
    ids = json.loads((D / "all_location_ids.json").read_text())
    passed = set(json.loads((D / "probe_pass.json").read_text()))
    async with session(96) as sess:
        sem = asyncio.Semaphore(96)

        async def one(i):
            async with sem:
                k, _ = await list_prefix(sess, f"records/csv.gz/locationid={i}/year=2025/")
                return i, [key[-15:-7] for key, _ in k]

        res = dict(await asyncio.gather(*[one(i) for i in ids if i not in passed]))
        (D / "y2025_days.json").write_text(json.dumps(res))
        cand = [i for i, d in res.items() if len(d) >= 120]

        async def meta(i):
            async with sem:
                d = res[i][len(res[i]) // 2]
                raw = await get(sess, f"{BUCKET}/records/csv.gz/locationid={i}/year=2025/month={d[4:6]}/location-{i}-{d}.csv.gz", binary=True)
                rows = list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode()))) if raw else []
                if not rows:
                    return None
                r = rows[0]
                return i, float(r["lat"]), float(r["lon"]), sum(x["parameter"] == "pm25" for x in rows), r["location"]

        ms = [m for m in await asyncio.gather(*[meta(i) for i in cand]) if m]
    (D / "meta_extra.json").write_text(json.dumps(ms, ensure_ascii=False))
    print(len(ms), "extra locations with at least 120 day-files in 2025")


if __name__ == "__main__":
    asyncio.run(main())
