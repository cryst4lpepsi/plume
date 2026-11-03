"""Country quotas and spatial thinning shared by the shortlist and the final station choice."""
import numpy as np
from .geo import haversine


def sqrt_quotas(counts: dict, target: int, power: float = 0.5) -> dict:
    """Allocate `target` slots across countries in proportion to sqrt(available), capped by availability.
    Square-root allocation keeps big networks big without letting one country swamp the graph."""
    quota = {c: 0 for c in counts}
    left, free = target, dict(counts)
    while left > 0 and free:
        w = {c: float(counts[c]) ** power for c in free}
        tot = sum(w.values())
        alloc = {c: min(free[c], max(1, int(round(left * w[c] / tot)))) for c in free}
        over = sum(alloc.values()) - left
        for c in sorted(alloc, key=lambda c: -alloc[c]):
            if over <= 0:
                break
            cut = min(over, alloc[c] - 1); alloc[c] -= cut; over -= cut
        for c, a in alloc.items():
            quota[c] += a; free[c] -= a; left -= a
        free = {c: n for c, n in free.items() if n > 0}
        if all(a == 0 for a in alloc.values()):
            break
    return quota


def farthest_point(lat, lon, k, score):
    """Pick k indices: start from the best score, then repeatedly add the point farthest from the
    chosen set (ties broken by score). Spreads stations instead of stacking them in one city."""
    lat, lon = np.radians(np.asarray(lat)), np.radians(np.asarray(lon))
    n = len(lat)
    if k >= n:
        return list(range(n))
    chosen = [int(np.argmax(score))]
    d = haversine(lat[chosen[0]], lon[chosen[0]], lat, lon)
    while len(chosen) < k:
        i = int(np.argmax(d + 1e-3 * np.asarray(score)))
        chosen.append(i)
        d = np.minimum(d, haversine(lat[i], lon[i], lat, lon))
    return chosen
