"""Region boxes and the study period. Europe and Asia are separate graphs."""
REGIONS = {
    "europe": {"lat": (34.0, 72.0), "lon": (-25.0, 45.0), "max_km": 300.0},
    "asia": {"lat": (-11.0, 55.0), "lon": (60.0, 150.0), "max_km": 500.0},
}
MONTHS = [(2024, 11), (2024, 12)] + [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 11)]
START, END = "2024-11-01T00:00", "2026-11-01T00:00"  # UTC, end exclusive
# time split (UTC): 18 months train, 3 validation, 3 test
VAL_START, TEST_START = "2026-05-01T00:00", "2026-08-01T00:00"


def region_of(lat, lon):
    for name, r in REGIONS.items():
        if r["lat"][0] <= lat <= r["lat"][1] and r["lon"][0] <= lon <= r["lon"][1]:
            return name
    return None
