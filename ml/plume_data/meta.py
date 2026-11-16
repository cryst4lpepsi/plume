"""Step 2: read one daily file per active location to learn coordinates, name and parameters."""
import asyncio, json, gzip, csv, io, time
from pathlib import Path
from .s3 import session, get, BUCKET

OUT = Path("data/discover")
DAYS = ["20250115", "20250116", "20250114", "20250120", "20250110", "20250125", "20250105"]


async def main():
    active = json.loads((OUT / "probe_pass.json").read_text())
    t0 = time.time()
    async with session(96) as sess:
        sem = asyncio.Semaphore(96)
        async def one(i):
            async with sem:
                for d in DAYS:
                    raw = await get(sess, f"{BUCKET}/records/csv.gz/locationid={i}/year=2025/month=01/location-{i}-{d}.csv.gz", binary=True)
                    if raw:
                        break
                else:
                    return None
                rows = list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode("utf-8"))))
                if not rows:
                    return None
                pm = [r for r in rows if r["parameter"] == "pm25"]
                r0 = rows[0]
                return {"id": i, "name": r0["location"], "lat": float(r0["lat"]), "lon": float(r0["lon"]),
                        "params": sorted({r["parameter"] for r in rows}), "pm25_rows_day": len(pm),
                        "pm25_sensors": sorted({r["sensors_id"] for r in pm}),
                        "tz": r0["datetime"][-6:]}
        res = [r for r in await asyncio.gather(*[one(i) for i in active]) if r]
    (OUT / "meta.json").write_text(json.dumps(res))
    print(len(res), "locations with metadata", f"{time.time()-t0:.0f}s")

if __name__ == "__main__":
    asyncio.run(main())
