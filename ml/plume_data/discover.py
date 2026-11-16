"""Step 1 of data: enumerate OpenAQ archive locations and find those active in the target period.

Writes data/discover/locations_active.json: {location_id: {ym: [n_files, bytes]}} for every
location that has files in the probe month. No API key is needed (public S3 listing).
"""
import asyncio, json, sys, time, re
from pathlib import Path
from .s3 import session, list_prefix

OUT = Path("data/discover"); OUT.mkdir(parents=True, exist_ok=True)
MONTHS = [(2024, 11), (2024, 12)] + [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 11)]
PROBE = [(2026, 9), (2025, 1)]  # must have files in both to be worth a full listing


async def all_locations(sess):
    f = OUT / "all_location_ids.json"
    if f.exists():
        return json.loads(f.read_text())
    async def one(d):
        _, p = await list_prefix(sess, f"records/csv.gz/locationid={d}", delimiter="/")
        return p
    res = await asyncio.gather(*[one(d) for d in range(1, 10)])
    ids = sorted(int(re.search(r"locationid=(\d+)/", p).group(1)) for ps in res for p in ps)
    f.write_text(json.dumps(ids))
    return ids


async def main():
    t0 = time.time()
    async with session(96) as sess:
        ids = await all_locations(sess)
        print(f"{len(ids)} locations in archive ({time.time()-t0:.0f}s)", flush=True)
        sem = asyncio.Semaphore(96)
        done = 0
        async def probe(i):
            nonlocal done
            async with sem:
                for y, m in PROBE:
                    k, _ = await list_prefix(sess, f"records/csv.gz/locationid={i}/year={y}/month={m:02d}/")
                    if len(k) < 20:
                        break
                else:
                    done += 1
                    return i
                done += 1
                if done % 5000 == 0:
                    print(f"  probed {done} ({time.time()-t0:.0f}s)", flush=True)
                return None
        pf = OUT / "probe_pass.json"
        if pf.exists():
            active = json.loads(pf.read_text())
        else:
            active = [i for i in await asyncio.gather(*[probe(i) for i in ids]) if i]
            pf.write_text(json.dumps(active))
        print(f"{len(active)} locations pass the probe ({time.time()-t0:.0f}s)", flush=True)
        async def full(i):
            async with sem:
                out = {}
                for y in (2024, 2025, 2026):
                    k, _ = await list_prefix(sess, f"records/csv.gz/locationid={i}/year={y}/")
                    for key, size in k:
                        m = re.search(r"-(\d{4})(\d{2})(\d{2})\.csv\.gz$", key)
                        if not m:
                            continue
                        ym = (int(m.group(1)), int(m.group(2)))
                        if ym in MONTHS:
                            e = out.setdefault(f"{ym[0]}-{ym[1]:02d}", [0, 0])
                            e[0] += 1; e[1] += size
                return i, out
        res = dict(await asyncio.gather(*[full(i) for i in active]))
        (OUT / "locations_active.json").write_text(json.dumps(res))
        print(f"done ({time.time()-t0:.0f}s)", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
