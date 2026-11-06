"""Baselines: persistence, seasonal naive, CAMS (via Open-Meteo open data), LightGBM per horizon.

python -m plume.baselines  ->  results/baselines.json, data/preds/{region}_{split}_{name}.npy"""
import json, sys, time
from pathlib import Path
import numpy as np
import lightgbm as lgb
from .config import *
from .data import load, eval_mask, targets, git_commit
from .metrics import score, add_skill

PRED = Path("data/preds"); PRED.mkdir(parents=True, exist_ok=True)
LAGS = (0, 1, 2, 3, 5, 8, 11, 17, 23, 35, 47)


def persistence(d, t):
    return np.repeat(from_z(d["anchor"][t])[:, :, None], HORIZON, 2)


def seasonal_naive(d, t):
    """Same hour yesterday: value at t+h-24. Falls back to persistence where that hour is missing."""
    idx = t[:, None] + np.arange(1, HORIZON + 1)[None, :] - 24
    sn = d["pm"][idx].transpose(0, 2, 1)
    return np.where(np.isnan(sn), persistence(d, t), sn)


def cams(d, t):
    idx = t[:, None] + np.arange(1, HORIZON + 1)[None, :]
    return d["cams"][idx].transpose(0, 2, 1)


def lgb_features(d, t):
    """Tabular features for (origin, station): the same inputs the graph model sees, flattened, no neighbours."""
    X, n = d["X"], d["X"].shape[1]
    zv = np.where(X[..., 1] > 0, X[..., 0], np.nan)                       # [T, N] z with NaN
    cols = [zv[t - k] for k in LAGS]
    for w in (6, 24, 48):
        win = np.stack([zv[t - k] for k in range(w)], 0)
        with np.errstate(all="ignore"):
            cols += [np.nanmean(win, 0), np.nanmin(win, 0), np.nanmax(win, 0), np.nanstd(win, 0)]
    cols += [d["anchor"][t], d["age"][t]]
    cols += [X[t][..., k] for k in range(2, 12)]                          # weather now + calendar
    cols += [d["wind"][t][..., k] for k in range(2, 6)]                   # 6 h and 24 h mean wind
    cols += [np.broadcast_to(d["lat"][None, :], (len(t), n)), np.broadcast_to(d["lon"][None, :], (len(t), n))]
    return np.stack(cols, -1).reshape(len(t) * n, -1).astype(np.float32)


def lgb_fit_predict(region, seed=0):
    d = load(region)
    t_tr, t_va = origins("train")[::6], origins("val")[::6]
    Xtr, Xva = lgb_features(d, t_tr), lgb_features(d, t_va)
    a_tr, a_va = d["anchor"][t_tr].ravel(), d["anchor"][t_va].ravel()
    ev = {s: origins(s) for s in ("val", "test")}
    Xev = {s: lgb_features(d, t) for s, t in ev.items()}
    out = {s: np.zeros((len(t), d["X"].shape[1], HORIZON), np.float32) for s, t in ev.items()}
    for h in range(1, HORIZON + 1):
        def xy(t, X, a):
            y = to_z(d["pm"][t + h]).ravel()
            ok = d["observed"][t + h].ravel() & ~np.isnan(a)
            return X[ok], (y - a)[ok]
        (xa, ya), (xb, yb) = xy(t_tr, Xtr, a_tr), xy(t_va, Xva, a_va)
        m = lgb.LGBMRegressor(objective="l1", n_estimators=200, learning_rate=0.12, num_leaves=63,
                              min_child_samples=100, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                              n_jobs=1, random_state=seed, verbose=-1)
        m.fit(xa, ya, eval_set=[(xb, yb)], callbacks=[lgb.early_stopping(25, verbose=False)])
        for s, t in ev.items():
            dz = m.predict(Xev[s]).reshape(len(t), -1)
            out[s][:, :, h - 1] = from_z(d["anchor"][t] + dz)
        print(region, "lgb h", h, "trees", m.best_iteration_, flush=True)
    return out


def main():
    res = {"script": "ml/plume/baselines.py", "commit": git_commit(), "units": "ug/m3",
           "horizons_h": list(range(1, HORIZON + 1))}
    for region in REGIONS:
        d = load(region)
        lg = lgb_fit_predict(region)
        res[region] = {}
        for split in ("val", "test"):
            t = origins(split)
            y, mask = targets(d, t), eval_mask(d, t)
            preds = {"persistence": persistence(d, t), "seasonal_naive": seasonal_naive(d, t),
                     "cams": cams(d, t), "lightgbm": lg[split]}
            np.save(PRED / f"{region}_{split}_lightgbm.npy", lg[split].astype(np.float16))
            res[region][split] = add_skill({k: score(np.nan_to_num(p), np.nan_to_num(y), mask) for k, p in preds.items()})
            print(region, split, {k: [round(v["mae"][h - 1], 2) for h in REPORT_H] for k, v in res[region][split].items()}, flush=True)
    Path("results/baselines.json").write_text(json.dumps(res))

if __name__ == "__main__":
    main()
