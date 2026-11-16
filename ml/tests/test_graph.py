"""Station selection and graph construction."""
import numpy as np
from plume.config import K_NEIGHBOURS
from plume.data import bearing, build_graph, haversine, rolling_mean
from plume_data.select import farthest_point, sqrt_quotas


def test_haversine_known_distance():
    # Paris to London, about 344 km
    assert abs(haversine(48.8566, 2.3522, 51.5074, -0.1278) - 344) < 2
    assert haversine(10.0, 20.0, 10.0, 20.0) == 0


def test_bearing_cardinal_directions():
    assert np.isclose(bearing(0, 0, 1, 0), 0)                # north
    assert np.isclose(bearing(0, 0, 0, 1), np.pi / 2)        # east
    assert np.isclose(abs(bearing(1, 0, 0, 0)), np.pi)       # south


def test_graph_respects_neighbour_and_distance_limits():
    rng = np.random.default_rng(0)
    lat, lon = 45 + rng.random(40) * 5, 5 + rng.random(40) * 5
    src, dst, dist, bear, isolated = build_graph(lat, lon, 300.0)
    assert (src != dst).all() and (dist <= 300.0).all()
    assert np.bincount(dst, minlength=40).max() <= K_NEIGHBOURS
    assert np.allclose(dist, haversine(lat[src], lon[src], lat[dst], lon[dst]), atol=1e-2)
    assert isolated == 0


def test_far_station_is_isolated():
    lat, lon = np.array([50.0, 50.1, 50.2, 0.0]), np.array([10.0, 10.1, 10.2, 100.0])
    src, dst, *_, isolated = build_graph(lat, lon, 300.0)
    assert isolated == 1 and 3 not in src and 3 not in dst


def test_rolling_mean_matches_direct_computation():
    x = np.random.default_rng(0).random((50, 3)).astype(np.float32)
    out = rolling_mean(x, 6)
    assert np.allclose(out[10], x[5:11].mean(0), atol=1e-5)
    assert np.allclose(out[2], x[:3].mean(0), atol=1e-5)     # shorter window at the start


def test_quotas_sum_to_target_and_respect_availability():
    counts = {"DE": 300, "FR": 120, "PL": 60, "CY": 3, "AD": 1}
    q = sqrt_quotas(counts, 100)
    assert sum(q.values()) == 100
    assert all(q[c] <= counts[c] for c in counts)
    assert q["DE"] > q["FR"] > q["PL"] and q["AD"] == 1
    assert q["DE"] / q["PL"] < counts["DE"] / counts["PL"]   # big networks are damped


def test_quotas_take_everything_when_target_exceeds_supply():
    counts = {"A": 5, "B": 2}
    assert sqrt_quotas(counts, 50) == counts


def test_farthest_point_spreads_stations():
    # a tight cluster of 20 plus three far-away stations
    lat = np.r_[np.full(20, 50.0) + np.arange(20) * 1e-3, 40.0, 60.0, 50.0]
    lon = np.r_[np.full(20, 10.0), 10.0, 10.0, 30.0]
    score = np.r_[1.0, np.zeros(22)]
    chosen = farthest_point(lat, lon, 4, score)
    assert chosen[0] == 0 and set(chosen[1:]) == {20, 21, 22}
    assert farthest_point(lat, lon, 99, score) == list(range(23))
