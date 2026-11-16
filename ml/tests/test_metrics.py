"""Scoring: masked MAE/RMSE, skill against persistence, interval coverage."""
import numpy as np
from plume.config import HORIZON, SCHEMES, SPLITS, T0, from_z, origins, to_z
from plume.metrics import add_skill, coverage, score


def test_score_ignores_masked_targets():
    y = np.zeros((4, 3, HORIZON))
    pred = np.full_like(y, 2.0)
    mask = np.ones(y.shape, bool)
    pred[0, 0, :] = 1000.0
    mask[0, 0, :] = False
    s = score(pred, y, mask)
    assert np.allclose(s["mae"], 2.0) and np.allclose(s["rmse"], 2.0)
    assert s["n"] == [11] * HORIZON


def test_rmse_is_at_least_mae():
    rng = np.random.default_rng(0)
    y, pred = rng.random((5, 4, HORIZON)), rng.random((5, 4, HORIZON))
    s = score(pred, y, np.ones(y.shape, bool))
    assert (np.array(s["rmse"]) >= np.array(s["mae"]) - 1e-12).all()


def test_skill_against_persistence():
    table = {"persistence": {"mae": [4.0, 2.0]}, "model": {"mae": [3.0, 2.5]}}
    add_skill(table)
    assert np.allclose(table["persistence"]["skill"], 0.0)
    assert np.allclose(table["model"]["skill"], [0.25, -0.25])


def test_coverage_counts_only_measured_hours():
    y = np.zeros((2, 2, HORIZON))
    p10, p90 = np.full_like(y, -1.0), np.full_like(y, 1.0)
    y[0, 0, :] = 5.0   # outside the band
    y[1, 1, :] = 5.0   # outside, but masked out
    mask = np.ones(y.shape, bool)
    mask[1, 1, :] = False
    assert np.allclose(coverage(p10, p90, y, mask), 2 / 3)


def test_z_transform_round_trips():
    pm = np.array([0.0, 1.0, 12.5, 300.0])
    assert np.allclose(from_z(to_z(pm)), pm)


def test_origins_keep_targets_inside_their_split():
    for split, (a, b) in SPLITS.items():
        t = origins(split)
        assert t[0] + 1 >= a and t[-1] + HORIZON < b
    # no forecast origin is shared between splits
    assert not set(origins("val")) & set(origins("test"))
    assert not set(origins("train")) & set(origins("val"))
    assert not set(origins("wval")) & set(origins("wtest"))
    assert not set(origins("wtrain")) & set(origins("wval"))


def test_winter_test_is_december_to_february_and_follows_its_training():
    a, b = SPLITS["wtest"]
    assert str(T0 + np.timedelta64(a, "h")) == "2025-12-01T00" and str(T0 + np.timedelta64(b, "h")) == "2026-03-01T00"
    assert SPLITS["wtrain"][1] == SPLITS["wval"][0] and SPLITS["wval"][1] == a
    assert all(p + s in SPLITS for p in SCHEMES.values() for s in ("train", "val", "test"))
