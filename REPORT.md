# Plume: report

## Summary

This is the second full run. Compared with the first it has European stations from the EEA (724 in Europe
instead of 420), satellite fire detections as an input, a tuning stage for both the graph model and
LightGBM, a second test on winter, and results for India and for European station types.

**Results, Europe (724 stations).** The graph model has the lowest mean absolute error at 3, 6, 12 and 24 h.
Over all 24 horizons it is 2.579 ±0.002 µg/m³ against 2.678 for LightGBM on the same inputs (3.7% lower),
3.488 for persistence and 3.587 for CAMS. At 1 h it ties LightGBM (1.35 both). Skill against persistence
at 24 h is +18.4%.

**Results, Asia (423 stations).** The graph model has the lowest error at all five reported horizons: 4.401
±0.008 over all horizons against 4.569 for LightGBM (3.7% lower), 5.645 for persistence and 9.471 for CAMS
global. Skill against persistence at 24 h is +15.4%.

**Winter (December 2025 to February 2026).** Models trained only on data to August 2025 were tested on the
following winter. The graph model still leads, but by less: 1.2% below LightGBM in Europe (5.848 against
5.919) and 0.6% in Asia (7.466 against 7.512). At Indian stations in winter LightGBM is better (17.86
against 18.01).

**What the graph is worth.** Message passing lowers error by 3.7% in Europe and 3.0% in Asia compared with
the same network without it. Wind-aware edges add nothing measurable over distance-only edges: the
difference is inside the seed spread in both regions.

**Unseen stations.** For a station with no history, the graph model beats inverse-distance interpolation of
its neighbours' forecasts in Asia (5.71 against 6.06) and is slightly behind it in Europe (3.29 against 3.26).

**Calibration.** P10 to P90 covers 80.8% of measurements in Europe and 80.3% in Asia (target 80%).

**Next.** Find out why wind-aware edges add nothing (forecast wind as an edge input, scoring on days with
strong transport between stations), add the CAMS forecast and forecast weather as inputs, and test whether
a calendar of fireworks nights and holidays helps in winter. Details are in [DECISIONS.md](DECISIONS.md).

## Data

### Sources actually used

| What | Source | Notes |
|---|---|---|
| PM2.5 observations, Asia and part of Europe | OpenAQ open-data archive on AWS (`openaq-data-archive`), anonymous access | One gzipped CSV per station per day. |
| PM2.5 observations, Europe | European Environment Agency download service | Hourly data from national networks, with each station's type (background, traffic, industrial) and area. 646 of the 724 European stations. |
| Fires (features) | NASA FIRMS, VIIRS on NOAA-21 | Fire radiative power within 100 and 300 km of each station over the previous 24 hours. Needs a free key. |
| CAMS PM2.5 (baseline) | Open-Meteo open-data bucket on AWS (`openmeteo`), `cams_europe` 0.1° and `cams_global` 0.4° | The same series the Open-Meteo Air Quality API serves. |
| Weather (features) | Same bucket, `copernicus_era5` 0.25°: 10 m wind u/v, 2 m temperature, dew point, precipitation, boundary-layer height | Relative humidity derived from temperature and dew point. |
| Base map | NASA Black Marble 2016 (GIBS WMS), Natural Earth 1:50m | |

Period: 2024-11-01 to 2026-10-31 UTC. Main split: train to 2026-04-30, validation May to July 2026, test
August to October 2026. Winter split: train to 2025-08-31, validation September to November 2025, test
December 2025 to February 2026.

### Coverage check (done first)

The OpenAQ archive holds about 56,500 location folders; 8,222 had files in both probe months. A second pass
over locations that failed the probe found that OpenAQ has no Indian (CPCB) data for November 2024 to
February 2025, so Indian stations lose their first winter. The EEA service has 3,596 sampling points in the
European box, of which 1,328 have 80% hourly coverage or better. China has about a dozen stations in the
OpenAQ archive in total.

### Data quality

<!-- results:quality:start -->
| | Europe | Asia |
|---|---:|---:|
| Candidates downloaded | not recorded | not recorded |
| PM2.5 rows read | not recorded | not recorded |
| Negative rows dropped | not recorded | not recorded |
| Rows above 2,000 µg/m³ dropped | not recorded | not recorded |
| Flat-lined hours removed (run of 12 h or more) | not recorded | not recorded |
| Single-hour spikes removed | not recorded | not recorded |
| Candidates at 80% coverage or better | not recorded | not recorded |
| Coverage threshold used | 80.0% | 70.0% |
| Candidates passing | not recorded | not recorded |
| Stations selected | 724 | 423 |
| Median coverage of selected stations | 96.6% | 83.7% |
| Station-hours | 12,684,480 | 7,410,960 |
| Observed | 11,987,974 | 6,165,650 |
| Filled by interpolation (gap of 3 h or less) | 126,066 | 268,933 |
| Missing, masked in the loss | 570,440 | 976,377 |
| Names romanised | 0 | 264 |
| Stations by source | EEA 646, OpenAQ 78 | OpenAQ 423 |

_Recomputed from data/processed. The download and cleaning counts were not recorded for this run._

**Europe: stations by country.** DE 107, FR 86, ES 70, BE 40, PL 40, AT 35, CZ 28, NL 28, SK 27, SE 23, NO 21, RO 21, HU 20, IT 20, BG 18, FI 14, GR 13, MK 12, SI 11, GB 10, PT 10, HR 9, RS 9, CH 8, CY 8, BA 5, IS 5, LT 5, LV 5, LU 4, TR 4, EE 3, MA 2, AD 1, ME 1, RU 1.

**Asia: stations by country.** JP 98, KR 85, IN 59, TH 57, TW 50, LA 30, HK 18, PH 6, SG 4, CN 3, MY 3, KP 2, KH 1, KZ 1, MM 1, MV 1, NP 1, PK 1, TJ 1, VN 1.
<!-- results:quality:end -->

Notes:

- This run restored its data stage from a checkpoint, so the cleaning step's counts (rows read, readings
  dropped, hours removed as flat lines or spikes) were not written out. Everything about the selected
  stations is recomputed from the processed data.
- Negative readings are dropped, not clipped; values above 2,000 µg/m³ are treated as error codes.
- The flat-line rule (identical value for 12 hours or more) also removes some genuine calm periods at
  stations that report whole numbers. The rule is kept on purpose.
- Gaps of up to 3 hours are linearly interpolated for model inputs. Interpolated hours are never used as
  targets in training or scoring.
- EEA stations carry a station type and area; OpenAQ stations do not, so in Asia and for the 78 OpenAQ
  stations in Europe, reference monitors and low-cost sensors are mixed.

### Graphs

See `results/graph.json`. Europe: 724 stations, 5,677 directed edges, median edge 74 km, 1 station with no
neighbour within 300 km. Asia: 423 stations, 3,217 edges, median edge 82 km (mean 109 km), 7 stations with
no neighbour within 500 km.

## Experiments

All test numbers below come from `results/*.json`; the tables are rendered by `ml/tools/report_tables.py`.
The test set was used only to produce these final numbers. Model selection (shared or per-region, best epoch)
used validation data.

### 1. Main comparison (MAE)

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

### 1b. Main comparison (RMSE)

<!-- results:rmse:start -->
**Europe** (RMSE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | **3.11 ±0.01** | **4.25 ±0.02** | **4.70 ±0.01** | **5.06 ±0.01** | **5.35 ±0.01** |  |
| LightGBM (no graph) | 3.11 | 4.32 | 4.85 | 5.18 | 5.38 |  |
| Persistence | 3.37 | 5.24 | 6.33 | 6.91 | 6.64 |  |
| Seasonal naive | 6.59 | 6.65 | 6.65 | 6.66 | 6.64 |  |
| CAMS via Open-Meteo | 6.94 | 6.94 | 6.94 | 6.93 | 6.89 |  |

**Asia** (RMSE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 6.70 ±0.01 | **9.44 ±0.08** | **10.44 ±0.08** | **10.90 ±0.09** | **11.22 ±0.01** |  |
| LightGBM (no graph) | **6.64** | 9.56 | 10.73 | 11.42 | 11.63 |  |
| Persistence | 7.09 | 11.05 | 13.27 | 14.24 | 13.48 |  |
| Seasonal naive | 13.07 | 13.18 | 13.28 | 13.32 | 13.48 |  |
| CAMS via Open-Meteo | 18.97 | 18.97 | 18.97 | 18.97 | 18.97 |  |

<!-- results:rmse:end -->

**Reading.** In both regions the graph model and LightGBM are far ahead of the three simple baselines and
close to each other. The graph model's advantage is largest in the middle horizons (Europe 6 h: 2.38
against 2.50; Asia 6 h: 4.08 against 4.28) and vanishes at 1 h. On RMSE, LightGBM is level at 1 h in Europe
and ahead at 1 h in Asia (6.64 against 6.70).

Model selection: the shared model had the lower validation error in both regions (Europe 2.483 against
2.496 per-region; Asia 4.819 against 4.863), so it is the model reported and shipped. On test the order is
the same.

Seasonal naive is no better than persistence at 24 h in either region. CAMS global is much worse than
persistence in Asia at every horizon; that says as much about a 0.4° grid average against point sensors,
many of them roadside or low-cost, as about CAMS. Neither CAMS series is bias-corrected.

### 2. Ablation: does the wind-aware graph help?

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

**Reading.** The ablation uses the per-region models, three seeds per variant.

- Message passing helps in both regions, well outside the seed spread: 3.7% lower error in Europe and 3.0%
  in Asia.
- Wind-aware edges on top of distance-only edges: Europe 2.600 against 2.599, Asia 4.434 against 4.440.
  Both differences are inside the seed spread. The wind feature on the edges adds nothing measurable.
- The graph helps a little more in the denser region (Europe, median edge 74 km) than in the sparser one.

Possible reasons, none tested: the node features already contain local wind, so the network can infer
transport without the edge feature; hourly station PM2.5 is dominated by local sources and the daily cycle;
edges of 74 to 82 km are short enough that neighbours are informative whatever the wind.

### 3. Calibration

<!-- results:calibration:start -->
| Region | 1 h | 3 h | 6 h | 12 h | 24 h | Mean over 24 h | Below P10 | Above P90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Europe | 81.1% | 81.0% | 80.8% | 80.8% | 80.9% | 80.8% | 10.5% | 8.6% |
| Asia | 79.2% | 79.9% | 80.3% | 80.5% | 80.7% | 80.3% | 10.0% | 9.8% |
<!-- results:calibration:end -->

**Reading.** Coverage is within 1 point of the 80% target at every reported horizon in both regions. The
misses are not symmetric in Europe: 10.5% of measurements fall below P10 and 8.6% above P90, so the band
sits slightly high. In Asia the band is a little narrow at 1 h (79.2%). No recalibration was applied.

### 4. Unseen stations

<!-- results:unseen:start -->
| Region | Method | 1 h | 3 h | 6 h | 12 h | 24 h |
|---|---|---:|---:|---:|---:|---:|
| Europe (109 held out) | Graph model, own history masked | 2.84 | 2.94 | 3.12 | 3.31 | 3.55 |
| Europe (109 held out) | Inverse-distance of neighbours' last values | 2.97 | 3.28 | 3.69 | 3.96 | 4.04 |
| Europe (109 held out) | Inverse-distance of neighbours' forecasts | 2.84 | 2.90 | 3.07 | 3.28 | 3.56 |
| Asia (63 held out) | Graph model, own history masked | 5.36 | 5.44 | 5.51 | 5.69 | 6.01 |
| Asia (63 held out) | Inverse-distance of neighbours' last values | 6.09 | 6.31 | 6.59 | 6.71 | 6.93 |
| Asia (63 held out) | Inverse-distance of neighbours' forecasts | 5.82 | 5.81 | 5.88 | 6.05 | 6.32 |
<!-- results:unseen:end -->

**Reading.** 15% of stations were removed from training (109 in Europe, 63 in Asia), and at test time their
own PM2.5 history is masked, so the model sees only their weather, position and neighbours. One seed.

- **Asia:** the graph model is better than both interpolation baselines (mean error over 24 horizons 5.71,
  against 6.06 for inverse-distance weighting of the neighbours' forecasts and 6.73 for their last values).
- **Europe:** the graph model beats interpolation of last values (3.29 against 3.86) and loses to
  interpolation of the neighbours' forecasts (3.26), by a small margin. In a dense network, averaging nearby
  forecasts is at least as good a way to fill in a station the model has never seen.

P10 to P90 coverage at the held-out stations averages 79.9% in Europe and 78.7% in Asia.

### 5. Seeds

The graph-model rows above are the mean ± standard deviation over seeds 0, 1 and 2. Per-seed error is in
`results/main.json` under `mae_per_seed`.

### 6. Winter test

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

**Reading.** These models never saw the winter they are tested on: they are trained on data to August 2025
and validated on September to November 2025. Errors are much higher than in summer (more than twice in
Europe, 1.7 times in Asia), as PM2.5 is. The graph model is still the most accurate over all horizons, but
its lead over LightGBM shrinks to 1.2% in Europe and 0.6% in Asia, and at 24 h LightGBM is level or
slightly ahead (Europe 7.07 against 7.10). LightGBM and the graph model both beat persistence
by about 15% at 24 h. The winter models are per-region; ten months of training data, rather than eighteen,
also hold them back, so these numbers are not comparable with the main table.

### 7. India

<!-- results:india:start -->
**India, 59 stations** (MAE, µg/m³, August to October 2026)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 3.88 ±0.02 | **6.41 ±0.01** | **7.34 ±0.02** | **7.94 ±0.01** | **8.42 ±0.02** | +12.2% |
| LightGBM (no graph) | **3.79** | 6.53 | 7.58 | 8.05 | 8.46 | +11.7% |
| Persistence | 4.14 | 7.83 | 9.96 | 10.84 | 9.59 | reference |
| Seasonal naive | 8.91 | 9.26 | 9.48 | 9.51 | 9.59 | +0.0% |
| CAMS via Open-Meteo | 16.86 | 16.86 | 16.88 | 16.88 | 16.91 | -76.5% |

**India, 59 stations** (MAE, µg/m³, December 2025 to February 2026, models trained on data to August 2025)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 8.25 ±0.03 | 15.27 ±0.15 | 18.83 ±0.22 | 19.15 ±0.27 | **18.54 ±0.53** | +7.3% |
| LightGBM (no graph) | **7.93** | **14.97** | **18.44** | **19.06** | 18.66 | +6.7% |
| Persistence | 8.83 | 18.45 | 25.00 | 25.10 | 19.99 | reference |
| Seasonal naive | 18.71 | 19.36 | 19.77 | 19.94 | 19.99 | +0.0% |
| CAMS via Open-Meteo | 33.69 | 33.69 | 33.66 | 33.63 | 33.60 | -68.0% |

<!-- results:india:end -->

**Reading.** 59 Indian stations inside the Asian model. In the summer test the graph model is ahead of
LightGBM (7.62 against 7.72). In winter, when Indian PM2.5 is highest, LightGBM is better over all horizons
(17.86 against 18.01), though the graph model is ahead at 24 h. Both beat persistence by about 24% over all
horizons but only by about 7% at 24 h. The winter models had no Indian winter to learn from:
OpenAQ's archive lacks Indian data for November 2024 to February 2025.

### 8. Station types (Europe)

<!-- results:types:start -->
| Station type | Stations | Period | Plume 1 h | Plume 24 h | LightGBM 24 h | Persistence 24 h | Plume skill at 24 h |
|---|---:|---|---:|---:|---:|---:|---:|
| Background | 435 | Aug to Oct 2026 | 1.26 | 2.87 | 2.92 | 3.56 | +19.2% |
| Background | 435 | Dec 2025 to Feb 2026 | 2.36 | 6.83 | 6.80 | 8.01 | +14.7% |
| Traffic | 154 | Aug to Oct 2026 | 1.45 | 3.14 | 3.17 | 3.86 | +18.8% |
| Traffic | 154 | Dec 2025 to Feb 2026 | 2.74 | 7.47 | 7.46 | 8.72 | +14.3% |
| Industrial | 57 | Aug to Oct 2026 | 1.41 | 3.03 | 3.05 | 3.68 | +17.8% |
| Industrial | 57 | Dec 2025 to Feb 2026 | 2.28 | 5.87 | 5.90 | 6.97 | +15.7% |
<!-- results:types:end -->

**Reading.** Only EEA stations carry a type. The graph model leads LightGBM at all three types in both test
periods. In the summer test traffic stations are the hardest to forecast and background stations the
easiest; in winter industrial stations have the lowest error.

### 9. Tuning

Four settings of the graph model were compared on validation loss (base: hidden 64, 2 layers, 6 epochs;
hidden 128; 3 layers; 10 epochs). Ten epochs won (0.333 against 0.343 for the base) and clears the 1%
threshold, so every final run trained for ten epochs. For LightGBM, 255 leaves with a learning rate of 0.06
and up to 500 trees won in both regions. Scores are in `results/tuning.json` and `results/baselines.json`.

## Failures and abandoned approaches

- **Open-Meteo HTTP APIs.** The historical weather API answered "Daily API request limit exceeded" after
  about 15 full-period requests (the container's egress address is shared). Replaced by reading Open-Meteo's
  own `.om` files from its AWS bucket: 216 ERA5 files of roughly 250 MB each, downloaded, sampled at station
  cells and deleted.
- **CAMS Europe came out wrong at first.** Its grid is stored north to south, unlike the other two. The
  first extraction read the wrong rows; a comparison with an API response for Berlin caught it (mean
  difference 1.6 µg/m³ instead of zero) and a grid search found the right orientation.
- **First OpenAQ download was empty.** Rows end in `\r\n`; the first parser split on `\n` only and every
  value failed to parse. Six minutes lost.
- **Shortlisting by daily file count.** A station with a file every day can still have two hours in each
  file. The first European shortlist (743 stations) produced only 316 above 80% hourly coverage, so all
  1,475 European candidates were downloaded.
- **Hyperparameter tuning in the first run.** Three trial runs were killed by a machine restart after one
  epoch. Tuning was done properly in this run (section 9).
- **A machine restart killed the first training batch** three hours into the build; nothing on disk was
  lost, but all in-flight runs were. Training now goes through a queue that skips finished runs.
- **Oracle-weather variant: not run.** It was optional and was dropped for time.
- **NASA image hosts** (`eoimages.gsfc.nasa.gov`) reset connections through the proxy; the texture comes from
  NASA GIBS instead.
- **Kaggle checkpoints that never restored.** Kaggle unpacks uploaded `.tar` files and refuses to send a large
  dataset as one download, so two training sessions restarted from scratch before the notebook was changed
  to name its checkpoints `.ckpt` and fetch them file by file. LightGBM also restarted from zero at each
  12-hour limit until it saved each finished horizon. The suite needed three Kaggle sessions.

## Limitations

- The winter test uses models trained on ten months of data, and Indian stations have no winter in training.
- The replay in the app covers the last 56 days of the test period with forecasts issued every 6 hours.
  Reported metrics use every hourly origin of the full three months.
- "Asia" is Japan, Korea, India, Thailand, Taiwan, Laos, Hong Kong and a handful of others. China is nearly
  absent and India lost four months of training data.
- Asia's coverage threshold is 70%, lower than Europe's 80%.
- Weather inputs are reanalysis. A live system would have forecasts and slightly worse recent analyses.
- CAMS comparisons favour CAMS at long horizons (short-lead stitched series) and penalise it for being a grid
  average compared with a point; the two regions use different CAMS products.
- Outside the EEA stations, low-cost sensors and reference monitors are mixed and cannot be told apart.
- Machine romanisation of Japanese, Korean, Chinese and Thai station names is rough.
- Frame rate was measured on one laptop GPU only (an RTX 3050 Ti); slower integrated graphics are untested.
- City labels come from the nearest GeoNames city, so a station near a border can carry a city from the
  other side.

## Verification

| Check | Result |
|---|---|
| One-command re-evaluation | `make eval` rewrote `results/*.json`, the app data and the tables; `make check` reloads the shipped binaries and reproduces `results/replay_check.json` (all 10 values match). |
| Numbers in the app | The Methods page and the Terminal scoreboard import `results/*.json` at build time; no metric is typed into the interface. |
| Screenshots | `node qa/screens.cjs` writes all 7 views at 1440, 1024 and 390 px to `docs/screenshots/` (21 files), with no page errors. Each was looked at. Fixed as a result: scoreboard clipped at 1024 px, sideways overflow on the mobile terminal, chart labels colliding, table captions cut off on mobile. |
| Command bar | `node qa/commands.cjs`: every command, a typo ("MOVRS" suggests MOVERS), an unknown station and an unknown city behave as designed; history, autocomplete and number-key focus work. |
| Frame rate | `node qa/fps.cjs` → `results/frame_rate.json`: 1.22 frames per second in default mode and 1.49 in low-power mode at 1440×900. **This is Chromium's software renderer (SwiftShader) on a CPU with no GPU**, so it says nothing useful about a visitor's machine. On a laptop GPU (`node qa/fps.cjs --gpu --hz 144` → `results/frame_rate_gpu.json`, NVIDIA GeForce RTX 3050 Ti, Chrome, Direct3D 11) the globe runs at 142 frames per second in both modes, which is the 144 Hz display's limit: it keeps up with the screen, and its headroom beyond that is not measured. The app switches itself to low-power mode when the average frame takes longer than 28 ms. |
| Colour and contrast | `ml/tools/cvd_check.py` and `ml/tools/contrast_check.py` write `results/colour_check.json` and `results/contrast_check.json`. |
| Design review | Done by hand from the screenshots at all three widths. |
| Repository hygiene | No keys, raw data or model checkpoints are committed. Largest committed file: 13 MB (`web/public/data/asia/fc.f16`). |
