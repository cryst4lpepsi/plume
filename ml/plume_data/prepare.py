"""Step 6: clean the hourly series, measure coverage, choose the final stations per region,
attach Latin-script names, and write data/processed/{region}.npz + stations json + quality json."""
import json, re, unicodedata
from collections import defaultdict, Counter
from pathlib import Path
import numpy as np
import pandas as pd
from .geo import country_of, city_of
from .regions import REGIONS, START
from .select import sqrt_quotas, farthest_point
from .shortlist import POWER

RAW, OUT = Path("data/raw_hourly"), Path("data/processed")
OUT.mkdir(parents=True, exist_ok=True)
NH = 730 * 24
TARGET = 420
FLAT_RUN = 12          # identical value for >= 12 consecutive hours => sensor fault
SPIKE_RATIO = 10.0     # single hour > 10x rolling median => spike
SPIKE_FLOOR = 5.0      # the median is floored at 5 ug/m3 so clean-air noise is not called a spike
MAX_INTERP = 3         # gaps up to 3 h are linearly interpolated; longer gaps stay missing


def clean(x):
    """x: hourly float array with NaN. Returns cleaned copy and counts of removed hours."""
    x = x.copy()
    v = ~np.isnan(x)
    # flat-lines: runs of identical consecutive valid values
    change = np.ones(len(x), bool)
    change[1:] = (x[1:] != x[:-1]) | ~v[1:] | ~v[:-1]
    run_id = np.cumsum(change)
    run_len = np.bincount(run_id)[run_id]
    flat = v & (run_len >= FLAT_RUN)
    x[flat] = np.nan
    # single-hour spikes against a centred 25 h rolling median
    s = pd.Series(x)
    med = s.rolling(25, center=True, min_periods=6).median().to_numpy()
    with np.errstate(invalid="ignore"):
        hot = x > SPIKE_RATIO * np.maximum(med, SPIKE_FLOOR)
        prev = np.r_[False, hot[:-1]]; nxt = np.r_[hot[1:], False]
    spike = hot & ~prev & ~nxt
    x[spike] = np.nan
    return x, int(flat.sum()), int(spike.sum())


def interp_short(x):
    """Linear interpolation of gaps <= MAX_INTERP hours. Returns filled series and a mask of filled hours."""
    s = pd.Series(x)
    isn = s.isna()
    grp = (isn != isn.shift()).cumsum()
    glen = isn.groupby(grp).transform("sum")
    filled = s.interpolate(limit_area="inside")
    ok = isn & (glen <= MAX_INTERP) & filled.notna()
    out = x.copy(); out[ok.to_numpy()] = filled.to_numpy()[ok.to_numpy()]
    return out, ok.to_numpy()


_kks = None
def latin(name, iso=""):
    """Return (latin_name, method). Non-Latin scripts are romanised; Latin names keep their diacritics."""
    global _kks
    name = re.sub(r"-\d+$", "", name).strip()
    scripts = {unicodedata.name(ch, "X").split(" ")[0] for ch in name if ch.isalpha()}
    if scripts <= {"LATIN"}:
        return name, None
    if "HANGUL" in scripts:
        from hangul_romanize import Transliter
        from hangul_romanize.rule import academic
        out, how = Transliter(academic).translit(name), "hangul-romanize (academic)"
    elif "CJK" in scripts and iso in ("TW", "CN", "HK", "MO", "SG", "MY"):
        from pypinyin import lazy_pinyin
        out, how = " ".join(lazy_pinyin(name)), "pypinyin (Hanyu Pinyin, no tones)"
    elif scripts & {"CJK", "HIRAGANA", "KATAKANA"}:
        import pykakasi
        _kks = _kks or pykakasi.kakasi()
        out, how = " ".join(p["hepburn"] for p in _kks.convert(name) if p["hepburn"].strip()), "pykakasi (Hepburn)"
    else:
        from unidecode import unidecode
        out, how = unidecode(name), "unidecode"
    from unidecode import unidecode
    out = re.sub(r"\s+", " ", unidecode(out)).strip().title()
    return out, how


def main():
    short = json.loads(Path("data/discover/shortlist.json").read_text())
    quality = {}
    for reg in ("europe", "asia"):
        cands, series = [], {}
        tot = Counter()
        for c in short:
            if c["region"] != reg or not (RAW / f"{c['id']}.npz").exists():
                continue
            z = np.load(RAW / f"{c['id']}.npz")
            st = json.loads(str(z["stats"]))
            n = z["n"]
            x = np.where(n > 0, z["sum"] / np.maximum(n, 1), np.nan)
            raw_valid = int((n > 0).sum())
            x, n_flat, n_spike = clean(x)
            cov = float((~np.isnan(x)).mean())
            cands.append({**c, "coverage": cov, "raw_hours": raw_valid, "flat": n_flat, "spike": n_spike,
                          "negative": st["negative"], "over_2000": st["over_2000"], "rows": st["rows"]})
            series[c["id"]] = x
            tot.update(candidates=1, rows=st["rows"], negative=st["negative"], over_2000=st["over_2000"],
                       raw_hours=raw_valid, flat_hours=n_flat, spike_hours=n_spike)
        # coverage threshold: 80 %, Asia may fall back to 70 %
        cov_table = defaultdict(lambda: [0, 0, 0])
        for c in cands:
            t = cov_table[c["iso"]]; t[0] += 1; t[1] += c["coverage"] >= 0.8; t[2] += c["coverage"] >= 0.7
        thr = 0.8
        n80 = sum(c["coverage"] >= 0.8 for c in cands)
        ok80 = [c for c in cands if c["coverage"] >= 0.8]
        top_share_80 = max(Counter(c["iso"] for c in ok80).values()) / max(1, len(ok80))
        if reg == "asia":
            thr = 0.7  # see DECISIONS.md: 80 % leaves India out entirely (archive gap Nov 2024 to Feb 2025)
        ok = [c for c in cands if c["coverage"] >= thr]
        by = defaultdict(list)
        for c in ok:
            by[c["iso"]].append(c)
        q = sqrt_quotas({k: len(v) for k, v in by.items()}, min(TARGET, len(ok)), POWER[reg])
        chosen = []
        for iso, v in by.items():
            idx = farthest_point([c["lat"] for c in v], [c["lon"] for c in v], q[iso], [c["coverage"] for c in v])
            chosen += [v[i] for i in idx]
        chosen.sort(key=lambda c: (c["iso"], -c["lat"]))
        stations, translit = [], []
        pm = np.full((NH, len(chosen)), np.nan, np.float32)
        filled = np.zeros((NH, len(chosen)), bool)
        for j, c in enumerate(chosen):
            iso, country = country_of(c["lat"], c["lon"])
            city, city_km, pop, tz = city_of(c["lat"], c["lon"])
            name, how = latin(c["name"], iso)
            if how:
                translit.append({"id": c["id"], "original": re.sub(r"-\d+$", "", c["name"]), "latin": name, "method": how})
            x, f = interp_short(series[c["id"]])
            pm[:, j] = x; filled[:, j] = f
            stations.append(dict(id=c["id"], name=name, city=city, city_km=round(city_km, 1), city_pop=pop,
                                 iso=iso, country=country, tz=tz, lat=round(c["lat"], 5), lon=round(c["lon"], 5),
                                 coverage=round(c["coverage"], 4)))
        np.savez_compressed(OUT / f"{reg}.npz", pm=pm, filled=filled)
        (OUT / f"{reg}_stations.json").write_text(json.dumps(stations, ensure_ascii=False, indent=0))
        (OUT / f"{reg}_transliterated.json").write_text(json.dumps(translit, ensure_ascii=False, indent=0))
        cc = Counter(s["iso"] for s in stations)
        quality[reg] = dict(
            period=[START, "2026-10-31T23:00"], hours=NH, candidates_downloaded=tot["candidates"],
            rows_pm25=tot["rows"], dropped_negative_rows=tot["negative"], dropped_over_2000_rows=tot["over_2000"],
            candidate_station_hours=tot["raw_hours"], removed_flatline_hours=tot["flat_hours"],
            removed_spike_hours=tot["spike_hours"], coverage_threshold=thr,
            candidates_ge_80=n80, top_country_share_at_80=round(top_share_80, 3), candidates_ge_threshold=len(ok),
            stations=len(stations), per_country=dict(sorted(cc.items(), key=lambda kv: -kv[1])),
            per_country_candidates={k: dict(downloaded=v[0], ge80=int(v[1]), ge70=int(v[2])) for k, v in sorted(cov_table.items(), key=lambda kv: -kv[1][0])},
            station_hours=int(NH * len(stations)), observed_hours=int((~np.isnan(pm) & ~filled).sum()),
            interpolated_short_gap_hours=int(filled.sum()), missing_hours=int(np.isnan(pm).sum()),
            median_station_coverage=float(np.median([s["coverage"] for s in stations])),
            transliterated_names=len(translit),
        )
        print(reg, json.dumps({k: v for k, v in quality[reg].items() if k != "per_country_candidates"}))
    Path("results").mkdir(exist_ok=True)
    Path("results/data_quality.json").write_text(json.dumps(quality, indent=1))

if __name__ == "__main__":
    main()
