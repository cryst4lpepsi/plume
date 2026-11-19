# Plume

[![CI](https://github.com/cryst4lpepsi/plume/actions/workflows/ci.yml/badge.svg)](https://github.com/cryst4lpepsi/plume/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

PM2.5 across Europe and Asia, forecast 24 hours ahead by a graph of monitoring stations.

**[Open the live app](https://cryst4lpepsi.github.io/plume/)** (best on a desktop browser with WebGL).

Air-quality stations are nodes. Edges join neighbours and carry how strongly the wind blows from one to the
other. A small spatiotemporal graph network forecasts hourly PM2.5 for the next 24 hours at every station,
with a P10 to P90 range. The same forecasts are shown two ways:

- **Globe**: a 3D Earth with an atmosphere that glows faint green where the air is clean and thickens into
  amber and ember haze where it is not.
- **Terminal**: a dense, keyboard-first layout that treats cities like tickers, with a scoreboard of the
  model against its baselines.

A **Methods** page reports how good the model is, region by region, including where it loses.

The app is a **replay of a held-out test period** (September and October 2026), not a live service. It
covers 724 stations in Europe (646 from the European Environment Agency, 78 from OpenAQ) and 423 in Asia.

![Globe](docs/screenshots/globe-observed-1440.png)

![Terminal](docs/screenshots/terminal-1440.png)

## Results

Every number here is written by `ml/tools/report_tables.py` from `results/*.json`. All models are scored on
the same forecasts: every hourly origin in August to October 2026, every station that reported in the
previous 48 hours, every horizon whose target hour was really measured. The graph model's rows are the mean
and standard deviation of three seeds. Bold marks the lowest error in a column.

**Headline, stated plainly.** The graph model is the most accurate of the five models on mean absolute
error over all 24 horizons in both regions, but its margin over LightGBM, which sees no neighbours, is
modest: 3.7% in Europe and 3.7% in Asia. It ties LightGBM at 1 h. Wind-aware edges add nothing measurable
over distance-only edges. In a separate winter test the margin shrinks to 1.2% and 0.6%, and at Indian
stations in winter LightGBM is better. For stations it has never seen, the graph model beats interpolation
in Asia and is slightly behind it in Europe. Details and caveats are in [REPORT.md](REPORT.md).

<!-- results:main:start -->
**Europe** (MAE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 1.35 ±0.00 | **2.01 ±0.00** | **2.38 ±0.00** | **2.69 ±0.00** | **2.99 ±0.01** | +18.4% |
| LightGBM (no graph) | **1.35** | 2.10 | 2.50 | 2.79 | 3.02 | +17.5% |
| Persistence | 1.47 | 2.54 | 3.31 | 3.78 | 3.67 | reference |
| Seasonal naive | 3.62 | 3.64 | 3.65 | 3.66 | 3.67 | +0.0% |
| CAMS via Open-Meteo | 3.58 | 3.59 | 3.59 | 3.59 | 3.59 | +2.1% |

**Asia** (MAE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | **2.43 ±0.01** | **3.52 ±0.01** | **4.08 ±0.01** | **4.57 ±0.01** | **5.05 ±0.01** | +15.4% |
| LightGBM (no graph) | 2.46 | 3.69 | 4.28 | 4.73 | 5.17 | +13.4% |
| Persistence | 2.63 | 4.28 | 5.36 | 5.95 | 5.98 | reference |
| Seasonal naive | 5.76 | 5.85 | 5.91 | 5.94 | 5.98 | +0.0% |
| CAMS via Open-Meteo | 9.47 | 9.47 | 9.47 | 9.47 | 9.46 | -58.4% |

<!-- results:main:end -->

How to read this:

- **CAMS is not a fair 24-hour comparison.** The series Open-Meteo stores is stitched from recent forecast
  runs, so each value was made a few hours ahead. Its row is flat across horizons for that reason. Europe
  uses CAMS Europe (0.1°); Asia uses CAMS global (0.4°, 3-hourly, interpolated to hourly by Open-Meteo).
  Skill against CAMS in the two regions is not like for like.
- **The honest test of the graph is the LightGBM row**: same inputs, no neighbours.
- The main test period has no winter in it; the winter test below covers that.

### Winter (December 2025 to February 2026)

Models trained only on data to August 2025, so they never saw this winter. Not comparable with the main
table: the training period is eight months shorter.

<!-- results:winter:start -->
**Europe** (MAE, µg/m³, December 2025 to February 2026; models trained on data to August 2025)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 2.55 ±0.00 | **4.10 ±0.00** | **5.17 ±0.01** | **6.15 ±0.00** | 7.10 ±0.01 | +14.8% |
| LightGBM (no graph) | **2.54** | 4.17 | 5.29 | 6.25 | **7.07** | +15.1% |
| Persistence | 2.69 | 4.83 | 6.60 | 7.98 | 8.32 | reference |
| Seasonal naive | 8.25 | 8.27 | 8.30 | 8.31 | 8.32 | +0.0% |
| CAMS via Open-Meteo | 7.99 | 7.99 | 7.99 | 7.98 | 7.97 | +4.2% |

**Asia** (MAE, µg/m³, December 2025 to February 2026; models trained on data to August 2025)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 3.53 ±0.02 | **5.70 ±0.05** | **7.06 ±0.06** | **7.86 ±0.05** | **8.48 ±0.07** | +15.0% |
| LightGBM (no graph) | **3.48** | 5.80 | 7.13 | 7.91 | 8.49 | +14.8% |
| Persistence | 3.75 | 6.82 | 9.14 | 10.22 | 9.97 | reference |
| Seasonal naive | 9.76 | 9.86 | 9.93 | 9.97 | 9.97 | +0.0% |
| CAMS via Open-Meteo | 13.31 | 13.30 | 13.29 | 13.26 | 13.22 | -32.6% |

<!-- results:winter:end -->

### Does the wind-aware graph help?

<!-- results:ablation:start -->
| Region | Variant | Seeds | Mean MAE over 24 horizons | 1 h | 6 h | 24 h | vs no graph |
|---|---|---:|---:|---:|---:|---:|---:|
| Europe (median edge 74 km) | No graph | 3 | 2.700 ±0.003 | 1.39 ±0.00 | 2.54 ±0.01 | 3.07 ±0.00 | reference |
| Europe (median edge 74 km) | Distance-only edges | 3 | 2.599 ±0.001 | 1.36 ±0.00 | 2.41 ±0.00 | 2.99 ±0.00 | -3.76% |
| Europe (median edge 74 km) | Wind-aware edges | 3 | 2.600 ±0.005 | 1.36 ±0.00 | 2.41 ±0.01 | 3.00 ±0.01 | -3.70% |
| Asia (median edge 82 km) | No graph | 3 | 4.576 ±0.008 | 2.50 ±0.01 | 4.28 ±0.01 | 5.21 ±0.00 | reference |
| Asia (median edge 82 km) | Distance-only edges | 3 | 4.440 ±0.007 | 2.45 ±0.00 | 4.13 ±0.01 | 5.07 ±0.00 | -2.97% |
| Asia (median edge 82 km) | Wind-aware edges | 3 | 4.434 ±0.010 | 2.45 ±0.00 | 4.12 ±0.01 | 5.07 ±0.01 | -3.10% |
<!-- results:ablation:end -->

The interpretation, with its caveats, is in [REPORT.md](REPORT.md#ablation-does-the-wind-aware-graph-help).

### Calibration (share of measurements inside P10 to P90; target 80%)

<!-- results:calibration:start -->
| Region | 1 h | 3 h | 6 h | 12 h | 24 h | Mean over 24 h | Below P10 | Above P90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Europe | 81.1% | 81.0% | 80.8% | 80.8% | 80.9% | 80.8% | 10.5% | 8.6% |
| Asia | 79.2% | 79.9% | 80.3% | 80.5% | 80.7% | 80.3% | 10.0% | 9.8% |
<!-- results:calibration:end -->

## Run it

Requirements: Python 3.11+, Node 20+, about 30 GB of free disk for the data stage. No GPU. No API keys are needed; an optional free NASA key adds the fire inputs.

The full suite takes about 30 CPU-hours. The published numbers were produced on Kaggle's free CPU sessions
with [`notebooks/plume_kaggle.ipynb`](notebooks/plume_kaggle.ipynb), which runs the same `make` targets and
checkpoints to private datasets so a run resumes across Kaggle's 12-hour session limit.

```bash
make setup     # Python venv and web dependencies
make data      # download OpenAQ, EEA, ERA5, CAMS and fire extracts; clean; choose stations (about 1 h, network-bound)
make train     # baselines, tuning runs, then all graph-model runs (several hours on 4 CPU cores; safe to re-run after an interruption)
make eval      # re-score everything, rewrite results/*.json, re-export the app data, verify it, refresh the tables
make web       # dev server on http://localhost:5173
make build     # static site in web/dist
make test      # unit tests for the cleaning rules, station selection, graph and metrics
```

`make eval` is the one command that reproduces every number in the app and in this file from saved
predictions. `make check` reloads the shipped binary files and confirms they reproduce
`results/replay_check.json`.

The app data in `web/public/data/` (about 44 MB) is committed, so `make setup && make web` shows the app
without running the pipeline.

### Forecast one station

The bundles from the published run are attached to the
[v2.0 release](https://github.com/cryst4lpepsi/plume/releases/tag/v2.0); download them into `data/bundle/`.
`make bundle` builds them from your own run. It packs the reported model with everything it needs into `data/bundle/plume-{europe,asia}.npz`:
the trained weights, the station graph, and the model inputs for the replay window (the last 56 days of the
test period). With a bundle, one station's forecast needs no data download:

```bash
PYTHONPATH=ml python -m plume.predict data/bundle/plume-asia.npz --list Kanpur
PYTHONPATH=ml python -m plume.predict data/bundle/plume-asia.npz --station Kanpur --at 2026-10-20T06
```

It prints the 24 hourly forecasts (P10, P50, P90) issued at that hour beside what was measured. The whole
graph is run, because a station's forecast depends on its neighbours. Needs PyTorch (CPU is enough).

## Layout

```
ml/plume_data/   discovery, download, cleaning, station selection, ERA5/CAMS extraction
ml/plume/        tensors and graphs, baselines, model, training, evaluation, export
ml/tools/       colour-vision and contrast checks, table rendering
ml/tests/       unit tests for cleaning, station selection, graph and metrics
qa/             screenshot, command-bar and frame-rate scripts (Playwright; need `make web` running)
results/        every metric as JSON, each with the script and commit that wrote it
web/            Vite + React + TypeScript + three.js app
docs/           screenshots, font test shots
```

## Data and attribution

- **Observations:** [OpenAQ](https://openaq.org), open-data archive on AWS. OpenAQ aggregates measurements
  from many government and research providers, each under its own licence; check the provider's terms before
  reusing station data.
- **European observations:** [European Environment Agency](https://www.eea.europa.eu/en/datahub),
  Air Quality Download Service, hourly data reported by member countries (E1a and E2a).
- **Fires:** NASA [FIRMS](https://firms.modaps.eosdis.nasa.gov), VIIRS active fires
  from NOAA-21. Needs a free key in `FIRMS_MAP_KEY`; without it the fire inputs are zero.
- **CAMS PM2.5 baseline and ERA5 weather:** Copernicus Atmosphere Monitoring Service and Copernicus Climate
  Change Service, through [Open-Meteo](https://open-meteo.com)'s open-data distribution (CC BY 4.0).
  Contains modified Copernicus information.
- **Night lights:** NASA Black Marble 2016 via NASA GIBS (public domain).
- **Coastlines and country polygons:** Natural Earth (public domain). **City names:** GeoNames (CC BY 4.0).
- **Fonts:** Brygada 1918, Golos Text, Iosevka, all SIL Open Font License, self-hosted through Fontsource.

## More

- [REPORT.md](REPORT.md): data quality and coverage, every experiment, failures, limitations.
- [DECISIONS.md](DECISIONS.md): judgement calls made during the build, including the font test.

The code is released under the [MIT licence](LICENSE). The data keeps the licences of its sources, listed
above.
