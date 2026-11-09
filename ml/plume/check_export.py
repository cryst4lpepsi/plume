"""Reload the shipped frontend files and reproduce the numbers in results/replay_check.json.
Exits non-zero if any number differs by more than float16 rounding allows."""
import json, sys
from pathlib import Path
import numpy as np

TOL = 0.02


def main():
    ref = json.loads(Path("results/replay_check.json").read_text())
    bad = 0
    for region in ("europe", "asia"):
        p = Path("web/public/data") / region
        ix = json.loads((p / "index.json").read_text())
        n, H, O = len(ix["stations"]), ix["horizons"], ix["origins"]
        obs = np.frombuffer((p / "obs.f16").read_bytes(), np.float16).astype(np.float32).reshape(ix["hours"], n)
        fc = np.frombuffer((p / "fc.f16").read_bytes(), np.float16).astype(np.float32).reshape(O, n, H, 3)
        lg = np.frombuffer((p / "lgb.f16").read_bytes(), np.float16).astype(np.float32).reshape(O, n, H)
        orig = ix["originStart"] + ix["originStep"] * np.arange(O)
        y = obs[orig[:, None] + np.arange(1, H + 1)[None, :]].transpose(0, 2, 1)
        # persistence anchor: last value within 48 h at the issue hour, exactly as the frontend computes it
        anchor = np.full((O, n), np.nan, np.float32)
        for k in range(48):
            v = obs[orig - k]
            anchor = np.where(np.isnan(anchor), v, anchor)
        m = ~np.isnan(y) & ~np.isnan(anchor)[:, :, None]
        mae = lambda q: float(np.abs(np.where(m, np.nan_to_num(q) - np.nan_to_num(y), 0)).sum() / m.sum())
        got = {"n": int(m.sum()), "mae_plume_p50": mae(fc[..., 1]), "mae_lightgbm": mae(lg),
               "mae_persistence": mae(np.repeat(anchor[:, :, None], H, 2)),
               "coverage_p10_p90": float((((y >= fc[..., 0]) & (y <= fc[..., 2])) & m).sum() / m.sum())}
        for k, v in got.items():
            ok = abs(v - ref[region][k]) <= (0 if k == "n" else TOL)
            bad += not ok
            print(f"{region:7s} {k:18s} shipped {v:.4f}  results {ref[region][k]:.4f}  {'ok' if ok else 'MISMATCH'}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
