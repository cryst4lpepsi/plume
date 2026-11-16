"""Step 3: for PM2.5 locations inside the two regions, list every daily file in the 24-month
period (file count and bytes per month). Used only to shortlist download candidates."""
import asyncio, json, re, time
from pathlib import Path
from .s3 import session, list_prefix
from .regions import region_of, MONTHS

OUT = Path("data/discover")

async def main():
    meta = [m for m in json.loads((OUT / "meta.json").read_text()) if m["pm25_rows_day"] > 0 and region_of(m["lat"], m["lon"])]
    t0 = time.time(); n = 0
    async with session(64) as sess:
        sem = asyncio.Semaphore(64)
        async def full(i):
            nonlocal n
            async with sem:
                days = []
                for y, m in MONTHS:
                    k, _ = await list_prefix(sess, f"records/csv.gz/locationid={i}/year={y}/month={m:02d}/")
                    days += [(re.search(r"-(\d{8})\.csv\.gz$", key).group(1), size) for key, size in k]
                n += 1
                if n % 500 == 0:
                    print(n, f"{time.time()-t0:.0f}s", flush=True)
                return i, days
        res = dict(await asyncio.gather(*[full(m["id"]) for m in meta]))
    (OUT / "day_files.json").write_text(json.dumps(res))
    print("done", len(res), f"{time.time()-t0:.0f}s")

if __name__ == "__main__":
    asyncio.run(main())
