"""Step 7: weather (ERA5 reanalysis) and CAMS PM2.5 at station grid cells, read from Open-Meteo's
open-data bucket on AWS (s3://openmeteo, .om files). The public Open-Meteo HTTP APIs serve the same
data but their per-IP daily limit is exhausted after a handful of 24-month calls from this machine.

Each .om file is one variable x one time chunk on the model grid. We download a file, pick the
grid cells we need, cache them as .npy and delete the file. Usage: python -m plume_data.om_fetch <model>"""
import json, os, sys, time, subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import omfiles
from .regions import START, candidates

BASE = "https://openmeteo.s3.amazonaws.com/data"
H0 = int(datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp() // 3600)
NH = 730 * 24
MODELS = {
    # name: (chunk hours, lat0, lon0, step, nlat, nlon, variables)
    "copernicus_era5": (504, -90.0, -180.0, 0.25, 721, 1440,
                        ["wind_u_component_10m", "wind_v_component_10m", "temperature_2m", "dew_point_2m",
                         "precipitation", "boundary_layer_height"]),
    "cams_europe": (193, 30.05, -24.95, 0.1, 420, 700, ["pm2_5"]),
    "cams_global": (217, -90.0, -180.0, 0.4, 451, 900, ["pm2_5"]),
}


def cells_for(model, pts):
    """Nearest grid cell (i_lat, j_lon) for each (lat, lon); returns unique cells and the index into them."""
    _, lat0, lon0, step, nlat, nlon, _ = MODELS[model]
    # cams_europe stores latitude north to south (row 0 = 71.95 N); the other two grids run south to north.
    # Orientation and time alignment were verified against the Open-Meteo API for Berlin and Delhi.
    lat_idx = (71.95 - pts[:, 0]) / step if model == "cams_europe" else (pts[:, 0] - lat0) / step
    ij = np.stack([np.clip(np.rint(lat_idx), 0, nlat - 1),
                   np.clip(np.rint((pts[:, 1] - lon0) / step), 0, nlon - 1)], 1).astype(int)
    uniq, inv = np.unique(ij, axis=0, return_inverse=True)
    return uniq, inv.ravel()


def main(model):
    chunk_h, lat0, lon0, step, nlat, nlon, variables = MODELS[model]
    short = candidates()
    if model == "cams_europe":
        short = [s for s in short if s["region"] == "europe"]
    if model == "cams_global":
        short = [s for s in short if s["region"] == "asia"]
    pts = np.array([[s["lat"], s["lon"]] for s in short])
    cells, inv = cells_for(model, pts)
    out = Path(f"data/om/{model}"); out.mkdir(parents=True, exist_ok=True)
    (out / "cells.json").write_text(json.dumps({"ids": [s["id"] for s in short], "cell_of_station": inv.tolist(),
                                                "cells": cells.tolist(), "lat0": lat0, "lon0": lon0, "step": step}))
    chunks = list(range(H0 // chunk_h, (H0 + NH - 1) // chunk_h + 1))
    print(model, len(cells), "cells", len(chunks), "chunks", flush=True)
    t0 = time.time()

    def job(var, c):
        f = out / f"{var}_{c}.npy"
        if f.exists():
            return
        tmp = out / f"tmp{os.getpid()}_{var}_{c}.om"
        for attempt in range(5):
            r = subprocess.run(["curl", "-sS", "--fail", "--retry", "3", "-o", str(tmp), f"{BASE}/{model}/{var}/chunk_{c}.om"])
            if r.returncode == 0:
                break
            time.sleep(5)
        else:
            print("FAILED", var, c, flush=True); return
        rd = omfiles.OmFileReader(str(tmp))
        assert tuple(rd.shape) == (nlat, nlon, chunk_h), rd.shape
        a = np.stack([rd[int(i), int(j), :] for i, j in cells]).astype(np.float32)
        np.save(f, a); tmp.unlink()
        print(f"{var} {c} ok {time.time()-t0:.0f}s", flush=True)

    with ThreadPoolExecutor(3) as ex:
        todo = [(v, c) for v in variables for c in chunks]
        if os.environ.get("OM_REVERSE"):   # a second worker can run from the far end; finished files are skipped
            todo = todo[::-1]
        list(ex.map(lambda vc: job(*vc), todo))
    if os.environ.get("OM_REVERSE"):
        return
    # stitch to [cells, NH]
    for var in variables:
        full = np.full((len(cells), NH), np.nan, np.float32)
        for c in chunks:
            a = np.load(out / f"{var}_{c}.npy")
            lo, hi = c * chunk_h - H0, (c + 1) * chunk_h - H0
            s, e = max(lo, 0), min(hi, NH)
            full[:, s:e] = a[:, s - lo:e - lo]
        np.save(out / f"{var}.npy", full)
        print(var, "nan share", float(np.isnan(full).mean()), flush=True)

if __name__ == "__main__":
    main(sys.argv[1])
