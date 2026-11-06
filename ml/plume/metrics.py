"""Scoring shared by every model so comparisons are like for like."""
import numpy as np
from .config import HORIZON


def score(pred, y, mask):
    """pred, y: [O, N, 24] ug/m3; mask: bool. Returns per-horizon MAE, RMSE and count."""
    out = {}
    err = np.where(mask, pred - y, 0.0).astype(np.float64)
    n = mask.sum((0, 1))
    mae = np.abs(err).sum((0, 1)) / n
    rmse = np.sqrt((err ** 2).sum((0, 1)) / n)
    return {"mae": mae.tolist(), "rmse": rmse.tolist(), "n": n.tolist()}


def add_skill(table, ref="persistence"):
    """skill = 1 - MAE / MAE_persistence, per horizon."""
    base = np.array(table[ref]["mae"])
    for m in table.values():
        m["skill"] = (1 - np.array(m["mae"]) / base).tolist()
    return table


def coverage(p10, p90, y, mask):
    inside = (y >= p10) & (y <= p90) & mask
    return (inside.sum((0, 1)) / mask.sum((0, 1))).tolist()
