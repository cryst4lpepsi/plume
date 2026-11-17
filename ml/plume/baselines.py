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
    cols += [X[t][..., k] for k in range(2, X.shape[-1])]                 # weather now, calendar, fires
    cols += [d["wind"][t][..., k] for k in range(2, 6)]                   # 6 h and 24 h mean wind
    cols += [np.broadcast_to(d["lat"][None, :], (len(t), n)), np.broadcast_to(d["lon"][None, :], (len(t), n))]
    return np.stack(cols, -1).reshape(len(t) * n, -1).astype(np.float32)


# LightGBM settings tried on validation (horizons 1, 6 and 24 h); the first is the original setting
LGB_GRID = (dict(n_estimators=200, learning_rate=0.12, num_leaves=63, min_child_samples=100),
            dict(n_estimators=500, learning_rate=0.06, num_leaves=127, min_child_samples=100),
            dict(n_estimators=500, learning_rate=0.06, num_leaves=255, min_child_samples=200))
TUNE_H = (1, 6, 24)


def lgb_model(params, seed=0):
    return lgb.LGBMRegressor(objective="l1", subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                             n_jobs=1, random_state=seed, verbose=-1, **params)


def lgb_split(d, pre=""):
    """(features, anchor, origins) for the training and validation origins of a scheme, every 6th origin."""
    return [(lgb_features(d, t), d["anchor"][t].ravel(), t) for t in (origins(pre + "train")[::6], origins(pre + "val")[::6])]


def lgb_fit(d, split, h, params, seed=0):
    """One horizon: predicts the change from the anchor in z space. Returns the model and the validation set."""
    def xy(X, a, t):
        ok = d["observed"][t + h].ravel() & ~np.isnan(a)
        return X[ok], (to_z(d["pm"][t + h]).ravel() - a)[ok]
    (xa, ya), (xb, yb) = xy(*split[0]), xy(*split[1])
    m = lgb_model(params, seed).fit(xa, ya, eval_set=[(xb, yb)], callbacks=[lgb.early_stopping(25, verbose=False)])
    return m, xb, yb


def lgb_tune(region, d, split):
    """Validation MAE (z space, mean over TUNE_H) of each grid entry; returns (best, scores)."""
    scores = []
    for params in LGB_GRID:
        err = []
        for h in TUNE_H:
            m, xb, yb = lgb_fit(d, split, h, params)
            err.append(float(np.abs(m.predict(xb) - yb).mean()))
        scores.append(float(np.mean(err)))
        print(region, "lgb tune", params, round(scores[-1], 4), flush=True)
    return LGB_GRID[int(np.argmin(scores))], scores


def lgb_fit_predict(region, d, params, pre="", split=None, seed=0):
    split = split or lgb_split(d, pre)
    ev = {s: origins(s) for s in (pre + "val", pre + "test")}
    Xev = {s: lgb_features(d, t) for s, t in ev.items()}
    out = {s: np.zeros((len(t), d["X"].shape[1], HORIZON), np.float32) for s, t in ev.items()}
    for h in range(1, HORIZON + 1):
        m, _, _ = lgb_fit(d, split, h, params, seed)
        for s, t in ev.items():
            out[s][:, :, h - 1] = from_z(d["anchor"][t] + m.predict(Xev[s]).reshape(len(t), -1))
        print(region, pre + "lgb h", h, "trees", m.best_iteration_, flush=True)
    return out


def main():
    res = {"script": "ml/plume/baselines.py", "commit": git_commit(), "units": "ug/m3",
           "horizons_h": list(range(1, HORIZON + 1))}
    for region in REGIONS:
        d = load(region)
        main_split = lgb_split(d)
        params, tune = lgb_tune(region, d, main_split)
        lg = {**lgb_fit_predict(region, d, params, split=main_split), **lgb_fit_predict(region, d, params, "w")}
        res[region] = {"lightgbm_params": params, "lightgbm_tuning": [dict(p, val_mae_z=s) for p, s in zip(LGB_GRID, tune)]}
        for split in ("val", "test", "wval", "wtest"):
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
