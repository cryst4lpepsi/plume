"""Shared constants for the modelling code."""
import numpy as np

REGIONS = ("europe", "asia")
MAX_KM = {"europe": 300.0, "asia": 500.0}
K_NEIGHBOURS = 8
L_IN, HORIZON = 48, 24
QUANTILES = (0.1, 0.5, 0.9)
REPORT_H = (1, 3, 6, 12, 24)
T0 = np.datetime64("2024-11-01T00")
NH = 730 * 24
# split boundaries as hour indices from T0 (UTC): 18 / 3 / 3 months
VAL_START = int((np.datetime64("2026-05-01T00") - T0) / np.timedelta64(1, "h"))
TEST_START = int((np.datetime64("2026-08-01T00") - T0) / np.timedelta64(1, "h"))
SPLITS = {"train": (0, VAL_START), "val": (VAL_START, TEST_START), "test": (TEST_START, NH)}
# PM2.5 is modelled as z = log1p(ug/m3) - MU (fixed constants so both regions share one scale)
MU = 2.5


def to_z(pm):
    return np.log1p(pm) - MU


def from_z(z):
    return np.expm1(z + MU)


def origins(split):
    """Forecast origins t whose 24 targets t+1..t+24 all fall inside the split. Inputs may reach
    back into the previous split (the past is always known)."""
    a, b = SPLITS[split]
    lo = max(a - 1, L_IN - 1)
    return np.arange(lo, b - HORIZON)
