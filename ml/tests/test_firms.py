import numpy as np
import pandas as pd
from plume_data.firms import reduce, fire_load, chunks, WINDOW, NH


def frame(rows):
    return pd.DataFrame(rows, columns=["latitude", "longitude", "acq_date", "acq_time", "confidence", "frp"])


def test_reduce_bins_by_hour_and_cell_and_drops_low_confidence():
    h, lat, lon, frp = reduce([frame([
        (10.01, 100.02, "2024-11-01", 530, "n", 5.0),
        (10.04, 100.06, "2024-11-01", 559, "h", 7.0),    # same hour, same 0.1 degree cell
        (10.04, 100.06, "2024-11-01", 600, "n", 1.0),    # next hour
        (10.04, 100.06, "2024-11-01", 530, "l", 99.0),   # low confidence
        (10.04, 100.06, "2023-01-01", 530, "n", 99.0),   # long before the period
    ])])
    assert h.tolist() == [5, 6]
    assert np.allclose(frp, [12.0, 1.0])
    assert np.allclose(lat, 10.05) and np.allclose(lon, 100.05)


def test_fire_load_counts_only_past_detections_within_radius():
    h = np.array([10, 10], np.int32)
    lat, lon = np.array([0.0, 0.0], np.float32), np.array([0.5, 2.0], np.float32)   # about 56 km and 222 km east
    frp = np.array([4.0, 6.0], np.float32)
    out = fire_load(h, lat, lon, frp, np.array([0.0, 40.0]), np.array([0.0, 0.0]), radii=(100.0, 300.0), nh=100)
    assert out.shape == (100, 2, 2)
    assert out[9].sum() == 0                                  # nothing before the detection hour
    assert np.allclose(out[10, 0], [4.0, 10.0])
    assert np.allclose(out[10 + WINDOW - 1, 0], [4.0, 10.0])  # still inside the trailing window
    assert out[10 + WINDOW, 0].sum() == 0                     # and gone once the window has passed
    assert out[:, 1].sum() == 0                               # the far station sees nothing


def test_fire_load_uses_the_day_before_the_period():
    out = fire_load(np.array([-3], np.int32), np.array([0.0], np.float32), np.array([0.1], np.float32),
                    np.array([2.0], np.float32), np.array([0.0]), np.array([0.0]), nh=48)
    assert out[0, 0, 0] == 2.0 and out[WINDOW - 4, 0, 0] == 2.0 and out[WINDOW - 3, 0, 0] == 0


def test_chunks_cover_the_period():
    days = list(chunks())
    assert days[0] == "2024-10-31" and days[-1] >= "2026-10-27" and len(days) * 5 >= NH // 24 + 1
