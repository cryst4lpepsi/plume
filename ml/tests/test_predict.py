"""One-station forecasts from a bundle: station lookup, and a round trip through a small untrained model."""
import json
import numpy as np
import pytest
from plume.config import HORIZON, L_IN, NH, T0
from plume.predict import find, hour_index

STATIONS = [dict(id=11, name="Anand Vihar", city="Delhi"), dict(id=12, name="Punjabi Bagh", city="Delhi"),
            dict(id=13, name="Berlin Mitte", city="Berlin"), dict(id=14, name="Mitte", city="Hamburg")]


def test_find_prefers_id_then_exact_name_then_substring():
    assert find(STATIONS, "12") == [1]
    assert find(STATIONS, "mitte") == [3]                 # exact name beats the substring in "Berlin Mitte"
    assert find(STATIONS, "delhi") == [0, 1]
    assert find(STATIONS, "Atlantis") == []


def test_hour_index_counts_from_the_bundle_start():
    assert hour_index({"t0": "2026-09-01T00"}, "2026-09-02T06") == 30


def test_bundle_round_trip(tmp_path, monkeypatch):
    torch = pytest.importorskip("torch")
    from plume import bundle, predict
    from plume.data import build_graph
    from plume.model import N_FEAT, PlumeNet
    rng = np.random.default_rng(0)
    n = 5
    lat, lon = 48 + rng.random(n), 8 + rng.random(n)
    src, dst, dist, bear, _ = build_graph(lat, lon, 300.0)
    pm = (5 + 10 * rng.random((NH, n))).astype(np.float32)
    d = dict(X=rng.normal(0, 1, (NH, n, N_FEAT)).astype(np.float32), pm=pm, observed=np.ones((NH, n), bool),
             anchor=np.zeros((NH, n), np.float32), age=np.zeros((NH, n), np.float32), wind=np.zeros((NH, n, 6), np.float32),
             lat=lat, lon=lon, src=src, dst=dst, dist=dist, bear=bear)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data/runs").mkdir(parents=True); (tmp_path / "data/processed").mkdir()
    torch.manual_seed(0); model = PlumeNet(16, 1, "wind")
    torch.save(model.state_dict(), "data/runs/t.pt")
    (tmp_path / "data/runs/t.json").write_text(json.dumps(dict(hidden=16, layers=1, mode="wind")))
    st = [dict(id=i, name=f"S{i}", city="C", iso="XX", country="X", lat=float(lat[i]), lon=float(lon[i]), tz="UTC") for i in range(n)]
    (tmp_path / "data/processed/europe_stations.json").write_text(json.dumps(st))
    monkeypatch.setattr(bundle, "load", lambda region: d)
    start = NH - 200
    f = bundle.pack("europe", "t", start=start, out=tmp_path)
    meta, b, w = predict.read(f)
    assert meta["t0"] == str((T0 + np.timedelta64(start, "h")).astype("datetime64[h]")) and b["X"].shape == (200, n, N_FEAT)
    t = 100
    q = predict.forecast(meta, b, w, 2, t)
    # the same model on the full arrays at the same hour gives the same forecast (inputs went through float16)
    from plume.train import Region
    R = Region("europe", d=d)
    with torch.no_grad():
        x, anchor, has, age, wind, _, _ = R.batch(torch.as_tensor([start + t]))
        ref = torch.expm1(model.eval()(x, R.static, anchor, has, age, R.g, wind)[0][0, 2] + 2.5).numpy()
    assert q.shape == (HORIZON, 3) and np.allclose(q, ref, rtol=2e-2, atol=2e-2)
    assert (q[:, 0] <= q[:, 1]).all() and (q[:, 1] <= q[:, 2]).all()
    assert t >= L_IN - 1
