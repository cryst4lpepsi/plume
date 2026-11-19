"""Forecast PM2.5 for one station from a model bundle (see plume.bundle).

python -m plume.predict plume-europe.npz --station Berlin
python -m plume.predict plume-asia.npz --station Kanpur --at 2026-10-20T06
python -m plume.predict plume-asia.npz --list Kanpur

Prints the 24 hourly forecasts (P10, P50, P90) issued at the given hour, next to what was measured.
The whole graph is run, because a station's forecast depends on its neighbours; only the one station is shown.
Times are UTC."""
import argparse, json, sys
import numpy as np
from .config import L_IN, HORIZON, from_z


def read(path):
    z = np.load(path)
    meta = json.loads(str(z["meta"]))
    d = {k: z[k] for k in z.files if k != "meta" and not k.startswith("w/")}
    d["X"], d["wind"] = d["X"].astype(np.float32), d["wind"].astype(np.float32)
    weights = {k[2:]: z[k] for k in z.files if k.startswith("w/")}
    return meta, d, weights


def find(stations, query):
    """Indices of stations matching a query: an exact id, else an exact name, else a name or city containing it."""
    q = query.strip().lower()
    if q.isdigit():
        hit = [i for i, s in enumerate(stations) if str(s["id"]) == q]
        if hit:
            return hit
    exact = [i for i, s in enumerate(stations) if s["name"].lower() == q]
    return exact or [i for i, s in enumerate(stations) if q in s["name"].lower() or q in (s["city"] or "").lower()]


def hour_index(meta, when):
    return int((np.datetime64(when, "h") - np.datetime64(meta["t0"], "h")).astype(int))


def hour_time(meta, t):
    return np.datetime64(meta["t0"], "h") + np.timedelta64(int(t), "h")


def forecast(meta, d, weights, s, t):
    """[24, 3] ug/m3 for station s, issued at hour index t of the bundle window."""
    import torch
    from .model import PlumeNet
    from .train import Region
    model = PlumeNet(meta["hidden"], meta["layers"], meta["mode"])
    model.load_state_dict({k: torch.from_numpy(v) for k, v in weights.items()})
    model.eval()
    R = Region(meta["region"], d=d)
    with torch.no_grad():
        x, anchor, has, age, wind, _, _ = R.batch(torch.as_tensor([t]))
        q, _ = model(x, R.static, anchor, has, age, R.g, wind)
    return from_z(q[0, s].numpy())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Forecast PM2.5 for one station from a model bundle.")
    ap.add_argument("bundle"); ap.add_argument("--station", help="station id, name or city")
    ap.add_argument("--at", help="issue time, UTC, e.g. 2026-10-20T06 (default: the latest possible)")
    ap.add_argument("--list", metavar="QUERY", nargs="?", const="", help="list stations matching QUERY and exit")
    a = ap.parse_args(argv)
    meta, d, weights = read(a.bundle)
    st = meta["stations"]
    if a.list is not None:
        for i in find(st, a.list):
            print(f"{st[i]['id']:>12}  {st[i]['name']}  ({st[i]['city']}, {st[i]['iso']})")
        return
    if not a.station:
        sys.exit("give --station, or --list to see the stations")
    hits = find(st, a.station)
    if not hits:
        sys.exit(f"no station matches {a.station!r}; try --list")
    if len(hits) > 1:
        print(f"{len(hits)} stations match {a.station!r}; showing the first. Use --list {a.station!r} and pass an id to choose.", file=sys.stderr)
    s = hits[0]
    T = d["X"].shape[0]
    lo, hi = L_IN - 1, T - HORIZON - 1    # needs 48 h of history and 24 h of measurements to compare with
    t = hour_index(meta, a.at) if a.at else hi
    if not lo <= t <= hi:
        sys.exit(f"--at must be between {hour_time(meta, lo)} and {hour_time(meta, hi)} UTC for this bundle")
    q = forecast(meta, d, weights, s, t)
    issue = hour_time(meta, t)
    info = st[s]
    print(f"{info['name']} ({info['city']}, {info['country']})  {info['lat']:.3f}, {info['lon']:.3f}")
    print(f"Issued {issue} UTC by {meta['tag']}. ug/m3. Last measurement before issue: "
          + (f"{from_z(d['anchor'][t, s]):.1f}" if not np.isnan(d["anchor"][t, s]) else "none in 48 h"))
    print(f"{'hour (UTC)':<16} {'P10':>7} {'P50':>7} {'P90':>7} {'measured':>9}")
    for h in range(HORIZON):
        y = d["pm"][t + h + 1, s]
        seen = d["observed"][t + h + 1, s]
        print(f"{str(hour_time(meta, t + h + 1)):<16} {q[h, 0]:7.1f} {q[h, 1]:7.1f} {q[h, 2]:7.1f} {(f'{y:.1f}' if seen else '-'):>9}")

if __name__ == "__main__":
    main()
