"""Step 4: shortlist ~720 download candidates per region from the file listings.
Day-file coverage is only a proxy; the real hourly coverage test happens after download."""
import json
from collections import defaultdict
from pathlib import Path
from .geo import country_of
from .regions import region_of
from .select import sqrt_quotas, farthest_point

D = Path("data/discover")
POWER = {"europe": 0.75, "asia": 0.5}
THRESH = {"europe": 0.8, "asia": 0.7}


def main():
    meta = {m["id"]: m for m in json.loads((D / "meta.json").read_text())}
    cands = []
    for i, d in json.loads((D / "day_files.json").read_text()).items():
        m = meta[int(i)]
        cands.append(dict(id=int(i), region=region_of(m["lat"], m["lon"]), iso=country_of(m["lat"], m["lon"])[0],
                          lat=m["lat"], lon=m["lon"], cov=len(d) / 730, name=m["name"]))
    # second pass: locations that failed the two-month probe (mostly India, whose feed has no files
    # for Nov 2024 to Feb 2025 in the archive) judged on their 2025 day files
    y25 = json.loads((D / "y2025_days.json").read_text())
    for i, la, lo, n, name in json.loads((D / "meta_extra.json").read_text()):
        if n and region_of(la, lo) == "asia":
            cands.append(dict(id=i, region="asia", iso=country_of(la, lo)[0], lat=la, lon=lo,
                              cov=len(y25[str(i)]) / 365, name=name))
    short = []
    for reg in ("europe", "asia"):
        r = [c for c in cands if c["region"] == reg and c["cov"] >= THRESH[reg] and c["iso"] != "--"]
        by = defaultdict(list)
        for c in r:
            by[c["iso"]].append(c)
        if reg == "europe":
            # Day-file coverage overstates hourly coverage badly in Europe (a first pass with a 720-station
            # quota left only 316 above 80 %), so every European candidate is downloaded.
            short += r
            print(reg, len(r), "all candidates kept")
            continue
        q = sqrt_quotas({k: len(v) for k, v in by.items()}, 720, POWER[reg])
        print(reg, len(r), sorted(q.items(), key=lambda kv: -kv[1]))
        for iso, v in by.items():
            idx = farthest_point([c["lat"] for c in v], [c["lon"] for c in v], q[iso], [c["cov"] for c in v])
            short += [v[i] for i in idx]
    (D / "shortlist.json").write_text(json.dumps(short, ensure_ascii=False))
    print(len(short), "shortlisted")

if __name__ == "__main__":
    main()
