"""EEA parquet frames reduce to the same hourly sum/count layout as the OpenAQ download."""
import numpy as np
import pandas as pd
from plume_data.eea import NH, reduce, station_id


def frame(end, value, validity=1, agg="hour"):
    return pd.DataFrame({"End": pd.to_datetime(end), "Value": value, "AggType": agg, "Validity": validity})


def test_hour_label_is_the_end_of_the_interval():
    s, n, stats = reduce([frame(["2024-11-01 00:00", "2024-11-01 01:00", "2024-11-01 02:00"], [5.0, 7.0, 9.0])])
    assert n[:3].tolist() == [1, 1, 1] and s[:3].tolist() == [5.0, 7.0, 9.0] and stats["rows"] == 3


def test_invalid_negative_and_error_codes_are_dropped():
    d = frame(["2025-01-01 00:00"] * 4, [10.0, -9999.0, -3.0, 5000.0])
    d["Validity"] = [1, -99, 1, 1]
    s, n, stats = reduce([d])
    assert n.sum() == 1 and s.sum() == 10.0
    assert (stats["invalid"], stats["negative"], stats["over_2000"]) == (1, 1, 1)


def test_daily_rows_and_rows_outside_the_period_are_ignored():
    daily = frame(["2025-01-02 00:00"], [30.0], agg="day")
    outside = frame(["2024-10-31 23:00", "2026-11-01 00:00"], [1.0, 2.0])
    s, n, stats = reduce([daily, outside])
    assert n.sum() == 0 and stats["rows"] == 0 and len(s) == NH


def test_two_datasets_join_without_double_counting():
    verified = frame(["2025-12-31 23:00"], [4.0])
    current = frame(["2026-01-01 00:00"], [6.0])
    s, n, _ = reduce([verified, current])
    assert n.max() == 1 and s.sum() == 10.0


def test_station_ids_are_stable_and_outside_the_openaq_range():
    a = station_id("SPO.IT0459A_6001_BETA_2006-02-20_00_00_00")
    assert a == station_id("SPO.IT0459A_6001_BETA_2006-02-20_00_00_00")
    assert 1_000_000_000 <= a < 2_000_000_000
    assert np.int32(a) == a
