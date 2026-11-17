"""Pack the reported model with the inputs it needs into one file per region, so a forecast can be made
without the data stage.

python -m plume.bundle  ->  data/bundle/plume-{region}.npz
Each file holds the trained weights and their settings, the station list and graph, and the model inputs
for the replay window (the last 56 days of the test period plus the 48 h before). plume.predict reads it."""
import json
from pathlib import Path
import numpy as np
from .config import *
from .data import load, git_commit
from .export import A0, SHORT

OUT = Path("data/bundle")
SERIES = {"X": np.float16, "pm": np.float32, "observed": bool, "anchor": np.float32, "age": np.float32, "wind": np.float16}
STATIC = ("lat", "lon", "src", "dst", "dist", "bear")
STATION_KEYS = ("id", "name", "city", "iso", "country", "lat", "lon", "tz")


def chosen_tag(region):
    chosen = json.loads(Path("results/main.json").read_text())[region]["chosen"]
    return f"{SHORT[region]}_wind_s0" if chosen == "plume_per_region" else "sh_wind_s0"


def pack(region, tag, start=A0, out=OUT):
    import torch
    d = load(region)
    cfg = json.loads(Path(f"data/runs/{tag}.json").read_text())
    st = json.loads(Path(f"data/processed/{region}_stations.json").read_text())
    weights = {f"w/{k}": v.numpy() for k, v in torch.load(f"data/runs/{tag}.pt").items()}
    meta = dict(region=region, tag=tag, hidden=cfg["hidden"], layers=cfg["layers"], mode=cfg["mode"], commit=git_commit(),
                t0=str((T0 + np.timedelta64(int(start), "h")).astype("datetime64[h]")), hours=int(NH - start),
                stations=[{k: s[k] for k in STATION_KEYS} for s in st])
    out.mkdir(parents=True, exist_ok=True)
    f = out / f"plume-{region}.npz"
    np.savez_compressed(f, meta=json.dumps(meta, ensure_ascii=False), **weights,
                        **{k: d[k][start:].astype(t) for k, t in SERIES.items()}, **{k: d[k] for k in STATIC})
    return f


def main():
    for region in REGIONS:
        f = pack(region, chosen_tag(region))
        print(region, f, f"{f.stat().st_size / 1e6:.1f} MB")

if __name__ == "__main__":
    main()
