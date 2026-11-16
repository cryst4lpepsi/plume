"""Assemble model-ready tensors per region from the processed observations, ERA5 and CAMS extracts.

python -m plume.data  ->  data/tensors/{region}.npz (+ results/graph.json)"""
import json, subprocess
from pathlib import Path
import numpy as np
import pandas as pd
from .config import *
from plume_data import firms

PROC, OM, OUT = Path("data/processed"), Path("data/om"), Path("data/tensors")


def git_commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    d = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(d))


def bearing(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2, radians clockwise from north."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    y = np.sin(lon2 - lon1) * np.cos(lat2)
    x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(lon2 - lon1)
    return np.arctan2(y, x)


def build_graph(lat, lon, max_km):
    """Directed edges src -> dst: each dst receives from its K nearest stations within max_km."""
    n = len(lat)
    d = haversine(lat[:, None], lon[:, None], lat[None, :], lon[None, :])
    np.fill_diagonal(d, np.inf)
    src, dst = [], []
    for i in range(n):
        nb = np.argsort(d[i])[:K_NEIGHBOURS]
        nb = nb[d[i, nb] <= max_km]
        src += nb.tolist(); dst += [i] * len(nb)
    src, dst = np.array(src), np.array(dst)
    dist = d[dst, src]
    bear = bearing(lat[src], lon[src], lat[dst], lon[dst])  # direction of travel src -> dst
    isolated = int(n - len(np.unique(dst)))
    return src, dst, dist.astype(np.float32), bear.astype(np.float32), isolated


def om_at_stations(model, var, ids):
    c = json.loads((OM / model / "cells.json").read_text())
    pos = {i: k for k, i in enumerate(c["ids"])}
    cell = np.array([c["cell_of_station"][pos[i]] for i in ids])
    return np.load(OM / model / f"{var}.npy")[cell].T  # [T, N]


def local_calendar(tzs):
    """sin/cos of local hour-of-day and day-of-week, [T, N, 4]."""
    utc = pd.date_range("2024-11-01", periods=NH, freq="h", tz="UTC")
    out = np.zeros((NH, len(tzs), 4), np.float32)
    cache = {}
    for j, tz in enumerate(tzs):
        if tz not in cache:
            loc = utc.tz_convert(tz)
            h, d = loc.hour.to_numpy() + loc.minute.to_numpy() / 60, loc.day_of_week.to_numpy()
            cache[tz] = np.stack([np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24),
                                  np.sin(2 * np.pi * d / 7), np.cos(2 * np.pi * d / 7)], 1)
        out[:, j] = cache[tz]
    return out


def rolling_mean(x, k):
    c = np.cumsum(np.r_[np.zeros((1,) + x.shape[1:], np.float64), x.astype(np.float64)], 0)
    out = np.empty_like(x)
    idx = np.arange(len(x))
    lo = np.maximum(idx + 1 - k, 0)
    out[:] = ((c[idx + 1] - c[lo]) / (idx + 1 - lo)[:, None]).astype(np.float32)
    return out


def build(region):
    st = json.loads((PROC / f"{region}_stations.json").read_text())
    z = np.load(PROC / f"{region}.npz")
    pm, filled = z["pm"], z["filled"]                       # [T, N]
    ids = [s["id"] for s in st]
    lat, lon = np.array([s["lat"] for s in st]), np.array([s["lon"] for s in st])
    u = om_at_stations("copernicus_era5", "wind_u_component_10m", ids)
    v = om_at_stations("copernicus_era5", "wind_v_component_10m", ids)
    t2 = om_at_stations("copernicus_era5", "temperature_2m", ids)
    td = om_at_stations("copernicus_era5", "dew_point_2m", ids)
    pr = om_at_stations("copernicus_era5", "precipitation", ids)
    blh = om_at_stations("copernicus_era5", "boundary_layer_height", ids)
    mag = lambda t: np.exp(17.625 * t / (243.04 + t))      # Magnus; RH from T and dew point
    rh = np.clip(mag(td) / mag(t2), 0, 1)
    cams = om_at_stations("cams_europe" if region == "europe" else "cams_global", "pm2_5", ids)
    valid = ~np.isnan(pm)
    zpm = np.where(valid, to_z(np.nan_to_num(pm)), 0).astype(np.float32)
    cal = local_calendar([s["tz"] for s in st])
    # fire radiative power within 100 and 300 km over the last 24 h; zeros if FIRMS was not downloaded
    det = firms.load(region)
    fire = np.log1p(firms.fire_load(*det, lat, lon)) / 5 if det else np.zeros((NH, len(st), len(firms.RADII_KM)), np.float32)
    X = np.concatenate([zpm[..., None], valid[..., None].astype(np.float32),
                        (u / 5)[..., None], (v / 5)[..., None], ((t2 - 10) / 10)[..., None], rh[..., None],
                        np.log1p(np.maximum(pr, 0))[..., None], (np.log(np.maximum(blh, 1) + 10) - 6)[..., None],
                        cal, fire], -1).astype(np.float32)
    assert not np.isnan(X).any(), "weather has gaps"
    # anchor: last valid z within the previous 48 h (NaN if none) and its age in hours
    last = np.where(valid, np.arange(NH)[:, None], -1)
    last = np.maximum.accumulate(last, 0)
    age = np.arange(NH)[:, None] - last
    has = (last >= 0) & (age < L_IN)
    anchor = np.where(has, zpm[np.maximum(last, 0), np.arange(len(st))[None, :]], np.nan).astype(np.float32)
    age = np.where(has, age, L_IN).astype(np.float32)
    # node wind summaries for the dynamic edge feature: now, 6 h mean, 24 h mean (u, v in m/s)
    wind = np.stack([u, v, rolling_mean(u, 6), rolling_mean(v, 6), rolling_mean(u, 24), rolling_mean(v, 24)], -1).astype(np.float32)
    src, dst, dist, bear, isolated = build_graph(lat, lon, MAX_KM[region])
    OUT.mkdir(parents=True, exist_ok=True)
    np.savez(OUT / f"{region}.npz", X=X, pm=pm, observed=valid & ~filled, anchor=anchor, age=age, wind=wind,
             cams=cams.astype(np.float32), lat=lat, lon=lon, src=src, dst=dst, dist=dist, bear=bear)
    deg = np.bincount(dst, minlength=len(st))
    return dict(stations=len(st), fire_features=det is not None, edges=int(len(src)), isolated_self_loop_only=isolated, max_km=MAX_KM[region],
                k=K_NEIGHBOURS, mean_in_degree=float(deg.mean()), median_edge_km=float(np.median(dist)),
                mean_edge_km=float(dist.mean()), share_nodes_full_degree=float((deg == K_NEIGHBOURS).mean()),
                median_nearest_km=float(np.median([dist[dst == i].min() for i in range(len(st)) if (dst == i).any()])))


_cache = {}
def load(region):
    if region not in _cache:
        _cache[region] = dict(np.load(OUT / f"{region}.npz"))
    return _cache[region]


def eval_mask(d, t_orig):
    """[O, N, 24] True where the target hour was really observed (not interpolated) and the station
    reported at least once in the 48 h before the origin. Every model is scored on exactly this set."""
    tgt = t_orig[:, None] + np.arange(1, HORIZON + 1)[None, :]         # [O, 24]
    return d["observed"][tgt].transpose(0, 2, 1) & ~np.isnan(d["anchor"][t_orig])[:, :, None]


def targets(d, t_orig):
    tgt = t_orig[:, None] + np.arange(1, HORIZON + 1)[None, :]
    return d["pm"][tgt].transpose(0, 2, 1)                              # [O, N, 24] ug/m3


if __name__ == "__main__":
    info = {r: build(r) for r in REGIONS}
    Path("results/graph.json").write_text(json.dumps({"script": "ml/plume/data.py", "commit": git_commit(), **info}, indent=1))
    print(json.dumps(info, indent=1))
