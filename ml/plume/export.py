"""Export the replay for the static frontend: Float16 binaries + a JSON index per region.

python -m plume.export   -> web/public/data/{region}/..., results/replay_check.json
The replay covers the last 56 days of the test period; forecasts are issued every 6 h."""
import json
from collections import defaultdict
from pathlib import Path
import numpy as np
import torch
from .config import *
from .data import load, git_commit
from .model import PlumeNet
from .train import Region, predict
from . import baselines as B

OUT = Path("web/public/data")
REPLAY_DAYS, LEAD_IN, STEP = 56, 48, 6
REPLAY_START = NH - REPLAY_DAYS * 24
A0 = REPLAY_START - LEAD_IN
SHORT = {"europe": "eu", "asia": "as"}
LABEL = {"europe": "Europe", "asia": "Asia"}
BASE_RES = {"europe": "CAMS Europe, 0.1 degree, hourly", "asia": "CAMS global, 0.4 degree, served hourly"}


def main():
    main_res = json.loads(Path("results/main.json").read_text())
    check = {"script": "ml/plume/export.py", "commit": git_commit(), "note": "MAE over the exported replay issues only (float32 source); check_export.py recomputes these from the shipped float16 files.",
             "replay_days": REPLAY_DAYS, "issue_step_h": STEP}
    total = 0
    for region in REGIONS:
        d = load(region); r = SHORT[region]
        chosen = main_res[region]["chosen"]
        tag = f"{r}_wind_s0" if chosen == "plume_per_region" else "sh_wind_s0"
        cfg = json.loads(Path(f"data/runs/{tag}.json").read_text())
        st = json.loads(Path(f"data/processed/{region}_stations.json").read_text())
        n = len(st)
        orig = np.arange(REPLAY_START, NH - HORIZON, STEP)
        ti = orig - origins("test")[0]
        fc = np.load(f"data/preds/{region}_test_{tag}.npy")[ti].astype(np.float32)          # [O,N,24,3]
        lgf = Path(f"data/preds/{region}_test_lightgbm.npy")
        if not lgf.exists():
            print("WARNING: no LightGBM predictions for", region, "- exporting NaN (provisional export only)")
        lg = np.load(lgf)[ti].astype(np.float32) if lgf.exists() else np.full(fc.shape[:3], np.nan, np.float32)
        # learned edge weights (attention x gate, last message-passing layer) for the same issues
        model = PlumeNet(cfg["hidden"], cfg["layers"], cfg["mode"])
        model.load_state_dict(torch.load(f"data/runs/{tag}.pt"))
        _, w = predict(model, Region(region), orig, want_edges=True)
        att = np.clip(np.rint(w.astype(np.float32) * 255), 0, 255).astype(np.uint8)        # [O,E]
        obs = d["pm"][A0:NH].astype(np.float16)
        cams = d["cams"][A0:NH].astype(np.float16)
        wind = np.clip(np.rint(d["wind"][A0:NH, :, 0:2] * 8), -127, 127).astype(np.int8)
        out = OUT / region; out.mkdir(parents=True, exist_ok=True)
        files = {"obs.f16": obs, "cams.f16": cams, "wind.i8": wind, "fc.f16": fc.astype(np.float16),
                 "lgb.f16": lg.astype(np.float16), "att.u8": att}
        for name, arr in files.items():
            (out / name).write_bytes(np.ascontiguousarray(arr).tobytes()); total += arr.nbytes
        # cities: stations grouped by nearest sizeable city; the 16 most populous per region feed the ticker
        groups = defaultdict(list)
        for i, s in enumerate(st):
            groups[(s["city"], s["iso"])].append(i)
        cities = [dict(name=c, iso=iso, country=st[ix[0]]["country"], pop=st[ix[0]]["city_pop"], stations=ix,
                       lat=round(float(np.mean([st[i]["lat"] for i in ix])), 3), lon=round(float(np.mean([st[i]["lon"] for i in ix])), 3))
                  for (c, iso), ix in groups.items()]
        cities.sort(key=lambda c: -c["pop"])
        for k, c in enumerate(cities):
            c["major"] = k < 16
        index = dict(region=region, label=LABEL[region], t0=str((T0 + np.timedelta64(int(A0), "h")).astype("datetime64[s]")), hours=int(NH - A0), leadIn=LEAD_IN,
                     originStart=int(REPLAY_START - A0), originStep=STEP, origins=int(len(orig)), horizons=HORIZON,
                     stations=[{k: s[k] for k in ("id", "name", "city", "iso", "country", "lat", "lon", "tz")} for s in st],
                     cities=cities, edges=[[int(a), int(b), round(float(km), 1)] for a, b, km in zip(d["src"], d["dst"], d["dist"])],
                     model=f"{chosen} ({tag})", baselineResolution=BASE_RES[region], units="ug/m3", commit=git_commit())
        (out / "index.json").write_text(json.dumps(index, ensure_ascii=False))
        total += (out / "index.json").stat().st_size
        # numbers the check script must reproduce from the shipped files
        tgt = orig[:, None] + np.arange(1, HORIZON + 1)[None, :]
        y = d["pm"][tgt].transpose(0, 2, 1); m = ~np.isnan(y) & ~np.isnan(d["anchor"][orig])[:, :, None]
        pers = B.persistence(d, orig)
        mae = lambda p: float(np.abs(np.where(m, np.nan_to_num(p) - np.nan_to_num(y), 0)).sum() / m.sum())
        check[region] = {"n": int(m.sum()), "mae_plume_p50": mae(fc[..., 1]), "mae_lightgbm": mae(lg), "mae_persistence": mae(pers),
                         "coverage_p10_p90": float((((y >= fc[..., 0]) & (y <= fc[..., 2])) & m).sum() / m.sum())}
        print(region, tag, {k: round(v, 4) if isinstance(v, float) else v for k, v in check[region].items()})
    check["total_bytes"] = int(total)
    Path("results/replay_check.json").write_text(json.dumps(check, indent=1))
    print(f"export size {total/1e6:.1f} MB")

if __name__ == "__main__":
    main()
