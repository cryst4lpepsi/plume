"""Offline reverse geocoding: country (Natural Earth polygons), nearest city (GeoNames), timezone."""
import csv
from functools import lru_cache
import numpy as np
import shapefile
from shapely.geometry import shape, Point
from shapely.strtree import STRtree


@lru_cache(1)
def _countries():
    sf = shapefile.Reader("data/geo/ne_50m_admin_0_countries/ne_50m_admin_0_countries.shp")
    geoms, names, isos = [], [], []
    for sr in sf.shapeRecords():
        geoms.append(shape(sr.shape.__geo_interface__))
        rec = sr.record.as_dict()
        names.append(rec["NAME_LONG"]); isos.append(rec["ISO_A2_EH"] if rec["ISO_A2_EH"] != "-99" else rec["ISO_A2"])
    return STRtree(geoms), geoms, names, isos


def country_of(lat, lon):
    tree, geoms, names, isos = _countries()
    p = Point(lon, lat)
    for i in tree.query(p):
        if geoms[i].contains(p):
            return isos[i], names[i]
    i = tree.nearest(p)  # coastal stations just outside the simplified polygon
    return (isos[i], names[i]) if geoms[i].distance(p) < 0.5 else ("--", "Unknown")


@lru_cache(1)
def _cities():
    rows = []
    with open("data/geo/cities15000/cities15000.txt", encoding="utf-8") as f:
        for r in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            rows.append((r[2], float(r[4]), float(r[5]), r[8], int(r[14] or 0), r[17]))
    return rows, np.radians(np.array([[r[1], r[2]] for r in rows])), np.array([r[4] for r in rows])


def haversine(lat1, lon1, lat2, lon2):
    """Great-circle distance in km. Inputs in radians (numpy broadcastable)."""
    d = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(d))


def city_of(lat, lon):
    """Nearest sizeable city: prefer the largest city within 25 km, else the nearest one.
    Returns (ascii name, km, population, tz)."""
    rows, rad, pop = _cities()
    d = haversine(np.radians(lat), np.radians(lon), rad[:, 0], rad[:, 1])
    near = np.where(d < 25)[0]
    i = near[np.argmax(pop[near])] if len(near) else int(np.argmin(d))
    return rows[i][0], float(d[i]), int(pop[i]), rows[i][5]
