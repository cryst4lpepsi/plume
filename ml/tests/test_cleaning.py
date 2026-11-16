"""Cleaning rules: flat-line and spike removal, short-gap interpolation."""
import numpy as np
from plume_data.prepare import clean, interp_short, FLAT_RUN, MAX_INTERP


def noisy(n, seed=0):
    return 10 + np.random.default_rng(seed).random(n)


def test_flat_run_is_removed():
    x = noisy(200)
    x[50:50 + FLAT_RUN] = 7.0
    out, flat, spike = clean(x)
    assert flat == FLAT_RUN and spike == 0
    assert np.isnan(out[50:50 + FLAT_RUN]).all()
    assert not np.isnan(np.delete(out, np.s_[50:50 + FLAT_RUN])).any()


def test_short_flat_run_is_kept():
    x = noisy(200)
    x[50:50 + FLAT_RUN - 1] = 7.0
    out, flat, _ = clean(x)
    assert flat == 0 and not np.isnan(out).any()


def test_single_hour_spike_is_removed():
    x = noisy(200)
    x[100] = 500.0
    out, _, spike = clean(x)
    assert spike == 1 and np.isnan(out[100])


def test_two_hour_episode_is_kept():
    x = noisy(200)
    x[100:102] = 500.0
    out, _, spike = clean(x)
    assert spike == 0 and not np.isnan(out[100:102]).any()


def test_clean_air_noise_is_not_a_spike():
    x = np.full(200, 0.3) + np.random.default_rng(1).random(200) * 0.1
    x[100] = 4.0  # more than 10x the median, but under 10x the 5 ug/m3 floor
    _, _, spike = clean(x)
    assert spike == 0


def test_input_is_not_modified():
    x = noisy(200)
    x[100] = 500.0
    before = x.copy()
    clean(x)
    assert np.array_equal(x, before)


def test_short_gap_is_interpolated():
    x = np.arange(20, dtype=float)
    x[5:5 + MAX_INTERP] = np.nan
    out, filled = interp_short(x)
    assert np.allclose(out, np.arange(20))
    assert filled.sum() == MAX_INTERP and filled[5:5 + MAX_INTERP].all()


def test_long_gap_stays_missing():
    x = np.arange(20, dtype=float)
    x[5:5 + MAX_INTERP + 1] = np.nan
    out, filled = interp_short(x)
    assert np.isnan(out[5:5 + MAX_INTERP + 1]).all() and not filled.any()


def test_leading_gap_is_not_extrapolated():
    x = np.arange(20, dtype=float)
    x[:2] = np.nan
    out, filled = interp_short(x)
    assert np.isnan(out[:2]).all() and not filled.any()


def test_same_site_keeps_best_coverage():
    from plume_data.prepare import drop_same_site
    cands = [dict(id=1, lat=45.0, lon=9.0, coverage=0.7),
             dict(id=2, lat=45.0002, lon=9.0002, coverage=0.9),   # about 27 m from id 1
             dict(id=3, lat=45.01, lon=9.0, coverage=0.5)]        # about 1.1 km away
    kept, dropped = drop_same_site(cands)
    assert dropped == 1 and [c["id"] for c in kept] == [2, 3]
