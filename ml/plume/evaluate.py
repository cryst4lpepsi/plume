"""Score every run on the common evaluation set and write results/*.json.

python -m plume.evaluate   (re-scores saved predictions; `make eval` regenerates predictions first)"""
import json
from pathlib import Path
import numpy as np
from .config import *
from .data import load, eval_mask, targets, git_commit, haversine
from .metrics import score, coverage, add_skill
from . import baselines as B

PRED, RUNS, RES = Path("data/preds"), Path("data/runs"), Path("results")
SHORT = {"europe": "eu", "asia": "as"}
SEEDS = (0, 1, 2)


def load_pred(region, split, tag):
    f = PRED / f"{region}_{split}_{tag}.npy"
    return np.load(f).astype(np.float32) if f.exists() else None


def agg(scores):
    """Mean and sd across seeds of per-horizon metrics."""
    mae = np.array([s["mae"] for s in scores]); rmse = np.array([s["rmse"] for s in scores])
    return {"mae": mae.mean(0).tolist(), "mae_sd": mae.std(0).tolist(), "rmse": rmse.mean(0).tolist(),
            "rmse_sd": rmse.std(0).tolist(), "seeds": len(scores),
            "mae_all": float(mae.mean()), "mae_all_sd": float(mae.mean(1).std()),
            "mae_per_seed": mae.mean(1).tolist()}


def family(region, split, d, t, y, mask, pattern):
    out = []
    for s in SEEDS:
        p = load_pred(region, split, pattern.format(s=s))
        if p is not None:
            out.append(score(p[..., 1], y, mask))
    return out


def table(region, d, split, families, sel=None):
    """Baselines plus graph-model families ({name: tag pattern}) on a split, optionally for a subset of
    stations (bool [N]). None when the subset has nothing to score."""
    t = origins(split); y = np.nan_to_num(targets(d, t)); mask = eval_mask(d, t)
    if sel is not None:
        mask = mask & sel[None, :, None]
    if mask.sum((0, 1)).min() == 0:
        return None
    models = {"persistence": score(np.nan_to_num(B.persistence(d, t)), y, mask),
              "seasonal_naive": score(np.nan_to_num(B.seasonal_naive(d, t)), y, mask),
              "cams": score(np.nan_to_num(B.cams(d, t)), y, mask)}
    lg = load_pred(region, split, "lightgbm")
    if lg is not None:
        models["lightgbm"] = score(lg, y, mask)
    for name, pattern in families.items():
        fam = family(region, split, d, t, y, mask, pattern)
        if fam:
            models[name] = agg(fam)
    for m in models.values():
        m.setdefault("mae_all", float(np.mean(m["mae"])))
    return add_skill(models)


def station_groups(region):
    """Named subsets of a region's stations: India inside Asia, and the EEA station types in Europe."""
    st = json.loads(Path(f"data/processed/{region}_stations.json").read_text())
    if region == "asia":
        return {"india": np.array([s["iso"] == "IN" for s in st])}
    return {k: np.array([s.get("type") == k for s in st]) for k in ("background", "traffic", "industrial")}


def main():
    meta = {"script": "ml/plume/evaluate.py", "commit": git_commit(), "units": "ug/m3", "horizons_h": list(range(1, HORIZON + 1)),
            "report_horizons_h": list(REPORT_H), "note": "MAE/RMSE of the P50 forecast; mean and sd over 3 seeds; all models scored on identical (origin, station, horizon) triples."}
    main_res, abl, cal, unseen, station = dict(meta), dict(meta), dict(meta), dict(meta), dict(meta)
    winter = dict(meta, period="2025-12-01 to 2026-02-28 UTC", trained_on="2024-11-01 to 2025-08-31, validated on 2025-09-01 to 2025-11-30")
    slices = dict(meta)
    for region in REGIONS:
        d = load(region); r = SHORT[region]
        families = {"plume_per_region": r + "_wind_s{s}", "plume_shared": "sh_wind_s{s}", "ablation_none": r + "_none_s{s}",
                    "ablation_dist": r + "_dist_s{s}", "oracle_weather": r + "_oracle_s{s}"}
        split_res = {split: table(region, d, split, families) for split in ("val", "test")}
        # shared vs per-region: decided on validation MAE averaged over horizons and seeds
        v = split_res["val"]
        cands = {k: v[k]["mae_all"] for k in ("plume_per_region", "plume_shared") if k in v and k in split_res["test"]}
        chosen = min(cands, key=cands.get) if cands else None
        main_res[region] = {"chosen": chosen, "chosen_on": "validation mean MAE over 24 horizons", "val_mae_candidates": cands,
                            "n_eval_test": int(split_res["test"]["persistence"]["n"][0]), **split_res}
        if chosen:
            for split in ("val", "test"):
                split_res[split]["plume"] = split_res[split][chosen]
        abl[region] = {split: {"none": split_res[split].get("ablation_none"), "dist": split_res[split].get("ablation_dist"),
                               "wind": split_res[split].get("plume_per_region")} for split in ("val", "test")}
        # second evaluation (winter), and the same scores for named groups of stations
        win = {"plume": r + "_winter_s{s}"}
        winter[region] = table(region, d, "wtest", win)
        best = {"plume": families[chosen]} if chosen else {}
        slices[region] = {k: {"stations": int(sel.sum()), "test": table(region, d, "test", best, sel),
                              "winter": table(region, d, "wtest", win, sel)}
                          for k, sel in station_groups(region).items() if sel.any()}
        # calibration of the chosen model
        if chosen:
            pat = (r + "_wind_s{s}") if chosen == "plume_per_region" else "sh_wind_s{s}"
            t = origins("test"); y = np.nan_to_num(targets(d, t)); mask = eval_mask(d, t)
            cov, b10, b50, b90, width = [], [], [], [], []
            sta_mae = []
            for s in SEEDS:
                p = load_pred(region, "test", pat.format(s=s))
                if p is None:
                    continue
                cov.append(coverage(p[..., 0], p[..., 2], y, mask))
                n = mask.sum((0, 1))
                b10.append((((y < p[..., 0]) & mask).sum((0, 1)) / n).tolist())
                b50.append((((y < p[..., 1]) & mask).sum((0, 1)) / n).tolist())
                b90.append((((y < p[..., 2]) & mask).sum((0, 1)) / n).tolist())
                width.append((np.where(mask, p[..., 2] - p[..., 0], 0).sum((0, 1)) / n).tolist())
                sta_mae.append(np.where(mask, np.abs(p[..., 1] - y), 0).sum((0, 2)) / np.maximum(mask.sum((0, 2)), 1))
            ms = lambda a: {"mean": np.mean(a, 0).tolist(), "sd": np.std(a, 0).tolist()}
            cal[region] = {"model": chosen, "target": 0.8, "coverage_p10_p90": ms(cov), "share_below_p10": ms(b10),
                           "share_below_p50": ms(b50), "share_below_p90": ms(b90), "mean_band_width": ms(width)}
            pers = np.nan_to_num(B.persistence(d, t))
            station[region] = {"model_mae": np.mean(sta_mae, 0).round(3).tolist(),
                               "persistence_mae": (np.where(mask, np.abs(pers - y), 0).sum((0, 2)) / np.maximum(mask.sum((0, 2)), 1)).round(3).tolist(),
                               "n": mask.sum((0, 2)).tolist()}
        # unseen stations
        rj = RUNS / f"{r}_unseen_s0.json"
        if rj.exists():
            hold = np.array(json.loads(rj.read_text())["holdout"][region])
            t = origins("test"); y = np.nan_to_num(targets(d, t))
            # a held-out station has no history of its own, so only "target observed" is required
            tgt = t[:, None] + np.arange(1, HORIZON + 1)[None, :]
            mask = np.zeros_like(eval_mask(d, t)); mask[:, hold] = d["observed"][tgt].transpose(0, 2, 1)[:, hold]
            p = load_pred(region, "test", f"{r}_unseen_s0")
            vis = np.setdiff1d(np.arange(len(d["lat"])), hold)
            dist = haversine(d["lat"][hold][:, None], d["lon"][hold][:, None], d["lat"][vis][None, :], d["lon"][vis][None, :])
            w = 1.0 / np.maximum(dist, 1.0) ** 2
            w[dist > MAX_KM[region]] = 0
            nb = np.argsort(dist, 1)[:, :K_NEIGHBOURS]
            wk = np.take_along_axis(w, nb, 1)
            def idw(field):   # field [O, N_vis, 24] with NaN -> [O, hold, 24]
                f = field[:, vis][:, nb]                         # [O, H, K, 24]
                ww = wk[None, :, :, None] * ~np.isnan(f)
                return np.nansum(np.nan_to_num(f) * ww, 2) / np.maximum(ww.sum(2), 1e-9)
            pers_idw = np.zeros_like(y); pers_idw[:, hold] = idw(B.persistence(d, t))
            main_tag = (r + "_wind_s0") if main_res[region]["chosen"] == "plume_per_region" else "sh_wind_s0"
            pm = load_pred(region, "test", main_tag)
            res = {"graph_model_masked": score(p[..., 1], y, mask), "idw_of_neighbour_last_obs": score(pers_idw, y, mask)}
            if pm is not None:
                f_idw = np.zeros_like(y); f_idw[:, hold] = idw(pm[..., 1]); res["idw_of_neighbour_forecasts"] = score(f_idw, y, mask)
            has_nb = (dist.min(1) <= MAX_KM[region])
            unseen[region] = {"held_out": int(len(hold)), "held_out_with_neighbour_in_range": int(has_nb.sum()),
                              "coverage_p10_p90": coverage(p[..., 0], p[..., 2], y, mask), **res}
    RES.mkdir(exist_ok=True)
    for name, obj in (("main", main_res), ("ablation", abl), ("calibration", cal), ("unseen", unseen), ("station_error", station),
                      ("winter", winter), ("slices", slices)):
        (RES / f"{name}.json").write_text(json.dumps(obj))
    if (RUNS / "tuning.json").exists():
        (RES / "tuning.json").write_text((RUNS / "tuning.json").read_text())
    for region in REGIONS:
        print(region, "chosen:", main_res[region]["chosen"])
        for k, m in main_res[region]["test"].items():
            print(f"  {k:18s}", " ".join(f"{m['mae'][h-1]:6.2f}" for h in REPORT_H), f"| all {m['mae_all']:.3f}" + (f" ±{m['mae_all_sd']:.3f}" if "mae_all_sd" in m else ""))

if __name__ == "__main__":
    main()
