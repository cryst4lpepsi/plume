"""Rewrite results/data_quality.json from data/processed, for runs that restored the data stage from a checkpoint
(plume_data.prepare did not run, so its quality file would describe an earlier dataset).

Everything about the selected stations is recomputed exactly. The download and cleaning counts (candidates, rows
read, readings dropped, hours removed as flat lines or spikes) exist only while prepare runs on the raw downloads;
they are listed under not_recorded instead of being carried over from another run.

PYTHONPATH=ml python ml/tools/quality_from_processed.py"""
import json
from collections import Counter
from pathlib import Path
import numpy as np
from plume_data.regions import START

P = Path("data/processed")
THRESHOLD = {"europe": 0.8, "asia": 0.7}   # coverage thresholds in prepare.py
NOT_RECORDED = ["candidates_downloaded", "same_site_duplicates_dropped", "candidate_sites", "rows_pm25",
                "dropped_negative_rows", "dropped_over_2000_rows", "candidate_station_hours", "removed_flatline_hours",
                "removed_spike_hours", "candidates_ge_80", "top_country_share_at_80", "candidates_ge_threshold",
                "per_country_candidates"]

out = {"source": "ml/tools/quality_from_processed.py", "not_recorded": NOT_RECORDED,
       "note": "Recomputed from data/processed. The download and cleaning counts were not recorded for this run."}
for reg in ("europe", "asia"):
    st = json.loads((P / f"{reg}_stations.json").read_text(encoding="utf-8"))
    z = np.load(P / f"{reg}.npz")
    pm, filled = z["pm"], z["filled"]
    tr = P / f"{reg}_transliterated.json"
    cc = Counter(s["iso"] for s in st)
    out[reg] = dict(period=[START, "2026-10-31T23:00"], hours=int(pm.shape[0]), coverage_threshold=THRESHOLD[reg],
                    stations=len(st), stations_by_source=dict(Counter(s.get("source", "openaq") for s in st)),
                    per_country=dict(sorted(cc.items(), key=lambda kv: -kv[1])),
                    station_hours=int(pm.size), observed_hours=int((~np.isnan(pm) & ~filled).sum()),
                    interpolated_short_gap_hours=int(filled.sum()), missing_hours=int(np.isnan(pm).sum()),
                    median_station_coverage=float(np.median([s["coverage"] for s in st])),
                    transliterated_names=len(json.loads(tr.read_text(encoding="utf-8"))) if tr.exists() else None)
print(json.dumps(out, separators=(",", ":")))
Path("results/data_quality.json").write_text(json.dumps(out, indent=1))
