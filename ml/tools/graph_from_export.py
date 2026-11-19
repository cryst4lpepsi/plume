"""Rewrite results/graph.json from the exported app data (web/public/data/{region}/index.json), which holds every
station and graph edge. For runs that restored the data stage from a checkpoint, where plume.data did not run
and results/graph.json would otherwise describe an earlier dataset.

PYTHONPATH=ml python ml/tools/graph_from_export.py"""
import json
from pathlib import Path
from plume.config import REGIONS
from plume.data import graph_stats

out = {"script": "ml/tools/graph_from_export.py", "source": "web/public/data/{region}/index.json"}
for region in REGIONS:
    idx = json.loads(Path(f"web/public/data/{region}/index.json").read_text(encoding="utf-8"))
    src, dst, km = zip(*idx["edges"])
    out[region] = graph_stats(region, len(idx["stations"]), src, dst, km)
    out["commit"] = idx["commit"]
Path("results/graph.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
