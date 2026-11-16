# Plume: report

## Summary

**What works.** The whole pipeline runs end to end on real data with no API key: OpenAQ archive download and
cleaning, station selection, ERA5 and CAMS extraction, four baselines, the graph model (3 seeds, 3 edge
variants, shared and per-region), evaluation, export and the web app (Globe with four modes, station drawer,
Terminal with command bar, Methods). `make eval` regenerates every number shown in the app and in the
tables below from saved predictions.

**Results, Europe (420 stations).** The graph model has the lowest MAE at 3, 6, 12 and 24 h. Mean MAE over
all 24 horizons is 2.377 ±0.007 µg/m³ against 2.455 for LightGBM on the same inputs (3.2% lower), 3.109
for persistence and 3.287 for CAMS. At 1 h it ties LightGBM (1.04 both; LightGBM is ahead in the third
decimal and on RMSE), and at 24 h the gap is 0.01. Skill against persistence at 24 h is +17.9%.

**Results, Asia (423 stations).** The graph model has the lowest MAE at all five reported horizons: 4.487
±0.014 over all horizons against 4.598 for LightGBM (2.4% lower), 5.645 for persistence and 9.471 for CAMS
global. LightGBM has the lower RMSE at 1 h. Skill against persistence at 24 h is +14.7%.

**What the graph is worth.** Message passing lowers MAE by 4.4% in Europe and 3.1% in Asia compared with the
same network without it. Making the edges wind-aware adds almost nothing on top of distance-only edges:
0.006 µg/m³ in both regions, inside the seed spread in Asia. The premise of the project, that wind-aware
edges matter, is not supported by this test period.

**Unseen stations.** For a station with no history, the graph model beats inverse-distance weighting of its
neighbours' forecasts in Asia (5.75 against 6.09) and loses to it in Europe (3.84 against 3.68).

**Calibration.** P10 to P90 covers 81.0% of measurements in Europe and 80.4% in Asia (target 80%).

**What was cut or not done.** Hyperparameter tuning (interrupted, then dropped), the optional oracle-weather
variant, and a frame-rate measurement on real graphics hardware (the build container has software WebGL
only). Nothing on the planned feature list had to go: the unseen-station experiment, Influence view, command bar
and mobile layouts are all in.

**Three things to do next.**

1. Test through a winter. The test period is August to October; the season when PM2.5 matters most is
   unmeasured.
2. Find out why wind-aware edges add so little: try forecast wind over the next 24 hours as an edge input
   (the oracle variant), longer edges, and a per-episode evaluation on days with strong advection.
3. Tune the model and LightGBM properly. Both are at first-guess settings, so the 2 to 3% gap between them
   could move either way.

## Data

### Sources actually used

| What | Source | Notes |
|---|---|---|
| PM2.5 observations | OpenAQ open-data archive on AWS (`openaq-data-archive`), anonymous access | One gzipped CSV per station per day. 2,201 candidate stations, about 1.6 million files. No API key was available or needed. |
| CAMS PM2.5 (baseline) | Open-Meteo open-data bucket on AWS (`openmeteo`), `cams_europe` 0.1° and `cams_global` 0.4° | The same series the Open-Meteo Air Quality API serves; verified identical for Berlin and Delhi. |
| Weather (features) | Same bucket, `copernicus_era5` 0.25°: 10 m wind u/v, 2 m temperature, dew point, precipitation, boundary-layer height | Relative humidity derived from temperature and dew point. All six variables exist for the whole period with no gaps. |
| Base map | NASA Black Marble 2016 (GIBS WMS), Natural Earth 1:50m | |

Period: 2024-11-01 to 2026-10-31 UTC. Train to 2026-04-30, validation May to July 2026, test August to October 2026.

### Coverage check (done first)

The archive holds 56,459 location folders. 8,222 had files in both probe months; 3,469 of those report PM2.5
inside the two region boxes (1,541 Europe, 1,928 Asia). A second pass over locations that failed the probe
found 505 Indian stations whose files start in February to March 2025: OpenAQ's archive has no Indian (CPCB)
data for November 2024 to February 2025. China has about a dozen stations in the archive in total.

### Data quality

<!-- results:quality:start -->
| | Europe | Asia |
|---|---:|---:|
| Candidates downloaded | 1,475 | 726 |
| PM2.5 rows read | 46,872,343 | 14,545,878 |
| Negative rows dropped | 481,821 | 4,161 |
| Rows above 2,000 µg/m³ dropped | 18,820 | 192,795 |
| Flat-lined hours removed (run of 12 h or more) | 136,348 | 43,560 |
| Single-hour spikes removed | 1,877 | 2,127 |
| Candidates at 80% coverage or better | 643 | 387 |
| Coverage threshold used | 80.0% | 70.0% |
| Candidates passing | 643 | 557 |
| Stations selected | 420 | 423 |
| Median coverage of selected stations | 87.8% | 83.7% |
| Station-hours | 7,358,400 | 7,410,960 |
| Observed | 6,444,929 | 6,165,650 |
| Filled by interpolation (gap of 3 h or less) | 329,587 | 268,933 |
| Missing, masked in the loss | 583,884 | 976,377 |
| Names romanised | 0 | 264 |

**Europe: coverage by country** (candidates downloaded / at 80% or better / at 70% or better / selected)

| Country | Downloaded | ≥80% | ≥70% | Selected |
|---|---:|---:|---:|---:|
| DE | 318 | 279 | 304 | 132 |
| ES | 199 | 1 | 16 | 1 |
| FR | 144 | 77 | 124 | 51 |
| IT | 104 | 0 | 1 | 0 |
| PL | 83 | 66 | 76 | 46 |
| BE | 79 | 58 | 79 | 41 |
| AT | 50 | 1 | 46 | 1 |
| SK | 46 | 7 | 46 | 7 |
| NO | 43 | 0 | 28 | 0 |
| CZ | 41 | 0 | 0 | 0 |
| HU | 38 | 30 | 34 | 25 |
| SE | 37 | 0 | 5 | 0 |
| BG | 34 | 27 | 33 | 23 |
| NL | 29 | 28 | 29 | 24 |
| FI | 23 | 17 | 21 | 17 |
| JE | 23 | 0 | 16 | 0 |
| AM | 22 | 0 | 5 | 0 |
| GB | 19 | 12 | 14 | 12 |
| SI | 19 | 0 | 18 | 0 |
| RO | 18 | 6 | 10 | 6 |
| PT | 14 | 0 | 0 | 0 |
| HR | 12 | 0 | 0 | 0 |
| IS | 12 | 4 | 4 | 4 |
| CH | 9 | 8 | 8 | 8 |
| CY | 9 | 9 | 9 | 9 |
| GR | 8 | 0 | 3 | 0 |
| IE | 7 | 0 | 3 | 0 |
| LV | 7 | 3 | 7 | 3 |
| MT | 6 | 0 | 4 | 0 |
| EE | 6 | 3 | 6 | 3 |
| TR | 5 | 4 | 5 | 4 |
| LU | 4 | 0 | 4 | 0 |
| BA | 2 | 1 | 2 | 1 |
| DK | 1 | 0 | 1 | 0 |
| AD | 1 | 1 | 1 | 1 |
| RU | 1 | 1 | 1 | 1 |
| RS | 1 | 0 | 1 | 0 |
| MA | 1 | 0 | 0 | 0 |

**Asia: coverage by country** (candidates downloaded / at 80% or better / at 70% or better / selected)

| Country | Downloaded | ≥80% | ≥70% | Selected |
|---|---:|---:|---:|---:|
| JP | 182 | 158 | 176 | 98 |
| KR | 141 | 124 | 134 | 85 |
| IN | 118 | 0 | 64 | 59 |
| TH | 90 | 17 | 59 | 57 |
| TW | 51 | 48 | 50 | 50 |
| LA | 45 | 6 | 30 | 30 |
| KZ | 31 | 1 | 1 | 1 |
| HK | 18 | 17 | 18 | 18 |
| PH | 16 | 3 | 6 | 6 |
| CN | 7 | 2 | 3 | 3 |
| SG | 4 | 2 | 4 | 4 |
| ID | 4 | 0 | 0 | 0 |
| PK | 4 | 1 | 1 | 1 |
| TJ | 3 | 1 | 1 | 1 |
| MY | 3 | 2 | 3 | 3 |
| KP | 2 | 2 | 2 | 2 |
| VN | 2 | 1 | 1 | 1 |
| MM | 1 | 0 | 1 | 1 |
| LK | 1 | 0 | 0 | 0 |
| NP | 1 | 1 | 1 | 1 |
| MV | 1 | 1 | 1 | 1 |
| KH | 1 | 0 | 1 | 1 |
<!-- results:quality:end -->

Notes:

- Europe's negative count is large because several networks publish small negative values for clean air
  (instrument noise around zero); they are dropped, not clipped.
- Asia's 192,795 rows above 2,000 µg/m³ are error codes (values such as 9999), concentrated in a few feeds.
- The flat-line rule (identical value for 12 hours or more) also removes some genuine calm periods at
  stations that report whole numbers. The rule is kept on purpose; its cost is visible in the counts.
- Gaps of up to 3 hours are linearly interpolated for model inputs. Interpolated hours are never used as
  targets in training or scoring.
- Station type is unknown: the archive CSVs carry no provider field, so reference monitors and low-cost
  sensors are mixed.

### Graphs

See `results/graph.json`. Europe: 420 stations, 3,248 directed edges, median edge 65 km, 2 stations with no
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
| Plume graph model | 1.04 ±0.00 | **1.71 ±0.00** | **2.15 ±0.01** | **2.52 ±0.01** | **2.81 ±0.01** | +17.9% |
| LightGBM (no graph) | **1.04** | 1.78 | 2.27 | 2.60 | 2.83 | +17.6% |
| Persistence | 1.11 | 2.10 | 2.87 | 3.41 | 3.43 | reference |
| Seasonal naive | 3.31 | 3.36 | 3.40 | 3.42 | 3.43 | +0.0% |
| CAMS via Open-Meteo | 3.29 | 3.29 | 3.29 | 3.29 | 3.29 | +4.1% |

**Asia** (MAE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | **2.47 ±0.00** | **3.61 ±0.02** | **4.20 ±0.02** | **4.66 ±0.02** | **5.09 ±0.00** | +14.7% |
| LightGBM (no graph) | 2.49 | 3.73 | 4.33 | 4.76 | 5.18 | +13.3% |
| Persistence | 2.63 | 4.28 | 5.36 | 5.95 | 5.98 | reference |
| Seasonal naive | 5.76 | 5.85 | 5.91 | 5.94 | 5.98 | +0.0% |
| CAMS via Open-Meteo | 9.47 | 9.47 | 9.47 | 9.47 | 9.46 | -58.4% |

<!-- results:main:end -->

### 1b. Main comparison (RMSE)

<!-- results:rmse:start -->
**Europe** (RMSE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | 2.66 ±0.02 | **3.83 ±0.01** | **4.36 ±0.01** | **4.74 ±0.01** | 5.07 ±0.00 |  |
| LightGBM (no graph) | **2.66** | 3.90 | 4.50 | 4.85 | **5.06** |  |
| Persistence | 2.87 | 4.69 | 5.73 | 6.37 | 6.33 |  |
| Seasonal naive | 6.10 | 6.21 | 6.28 | 6.36 | 6.33 |  |
| CAMS via Open-Meteo | 6.82 | 6.82 | 6.82 | 6.82 | 6.80 |  |

**Asia** (RMSE, µg/m³, test period; chosen model: shared)

| Model | 1 h | 3 h | 6 h | 12 h | 24 h | Skill vs persistence at 24 h |
|---|---:|---:|---:|---:|---:|---:|
| Plume graph model | **6.67 ±0.03** | **9.44 ±0.04** | **10.54 ±0.01** | **10.99 ±0.01** | **11.28 ±0.00** |  |
| LightGBM (no graph) | 6.68 | 9.58 | 10.77 | 11.37 | 11.60 |  |
| Persistence | 7.09 | 11.05 | 13.27 | 14.24 | 13.48 |  |
| Seasonal naive | 13.07 | 13.18 | 13.28 | 13.32 | 13.48 |  |
| CAMS via Open-Meteo | 18.97 | 18.97 | 18.97 | 18.97 | 18.97 |  |

<!-- results:rmse:end -->

**Reading.** In both regions the graph model and LightGBM are far ahead of the three simple baselines and
close to each other. The graph model's advantage over LightGBM is largest in the middle horizons (Europe 6 h:
2.15 against 2.27; Asia 6 h: 4.20 against 4.33) and vanishes at 1 h, where both are barely better than
persistence. On RMSE, LightGBM is ahead at 1 h in both regions and level at 24 h in Europe.

Model selection: the shared model had the lower validation MAE in both regions (Europe 2.406 against 2.427
per-region; Asia 4.911 against 4.932), so it is the model reported and shipped. On test the order is the
same. The shared model's seed spread is larger than the per-region model's.

Seasonal naive is no better than persistence at 24 h in either region. CAMS global is much worse than
persistence in Asia at every horizon; that says as much about a 0.4° grid average against point sensors,
many of them roadside or low-cost, as about CAMS. Neither CAMS series is bias-corrected.

### 2. Ablation: does the wind-aware graph help?

<!-- results:ablation:start -->
| Region | Variant | Seeds | Mean MAE over 24 horizons | 1 h | 6 h | 24 h | vs no graph |
|---|---|---:|---:|---:|---:|---:|---:|
| Europe (median edge 65 km) | No graph | 3 | 2.503 ±0.009 | 1.08 ±0.00 | 2.34 ±0.01 | 2.90 ±0.01 | reference |
| Europe (median edge 65 km) | Distance-only edges | 3 | 2.399 ±0.001 | 1.05 ±0.00 | 2.19 ±0.00 | 2.81 ±0.00 | -4.16% |
| Europe (median edge 65 km) | Wind-aware edges | 3 | 2.393 ±0.001 | 1.04 ±0.00 | 2.18 ±0.01 | 2.81 ±0.00 | -4.41% |
| Asia (median edge 82 km) | No graph | 3 | 4.643 ±0.011 | 2.53 ±0.01 | 4.39 ±0.02 | 5.23 ±0.00 | reference |
| Asia (median edge 82 km) | Distance-only edges | 3 | 4.508 ±0.008 | 2.47 ±0.00 | 4.23 ±0.01 | 5.10 ±0.01 | -2.92% |
| Asia (median edge 82 km) | Wind-aware edges | 3 | 4.502 ±0.004 | 2.47 ±0.00 | 4.22 ±0.02 | 5.10 ±0.00 | -3.05% |
<!-- results:ablation:end -->

**Reading.** The ablation uses the per-region models, three seeds per variant.

- Message passing helps in both regions, well outside the seed spread: 4.2 to 4.4% lower MAE in Europe,
  2.9 to 3.1% in Asia.
- The wind feature on top of distance-only edges is worth 0.006 µg/m³ in each region (0.25% in Europe, 0.13%
  in Asia). In Europe that is larger than the seed standard deviations (0.001); in Asia it is not (0.004 and
  0.008). Either way it is too small to matter.
- The hypothesis that wind-aware edges help more where the network is sparse is not supported. The graph
  helps more in the denser region, and the wind increment is the same in both.

Possible reasons, none tested: the node features already contain local wind, so the network can infer
transport without the edge feature; hourly station PM2.5 in late summer is dominated by local sources and
the daily cycle; edges of 65 to 82 km are short enough that neighbours are informative whatever the wind.

### 3. Calibration

<!-- results:calibration:start -->
| Region | 1 h | 3 h | 6 h | 12 h | 24 h | Mean over 24 h | Below P10 | Above P90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Europe | 82.9% | 81.5% | 80.7% | 80.9% | 81.2% | 81.0% | 10.6% | 8.4% |
| Asia | 78.9% | 79.5% | 80.1% | 80.7% | 81.0% | 80.4% | 10.4% | 9.2% |
<!-- results:calibration:end -->

**Reading.** Coverage is within 3 points of the 80% target at every reported horizon in both regions. The misses are
not symmetric: more measurements fall below P10 (10.4 to 10.6%) than above P90 (8.4 to 9.2%), so the band
sits slightly high. In Asia the band is a little too narrow at 1 h (78.9%). No recalibration was applied.

### 4. Unseen stations

<!-- results:unseen:start -->
| Region | Method | 1 h | 3 h | 6 h | 12 h | 24 h |
|---|---|---:|---:|---:|---:|---:|
| Europe (63 held out) | Graph model, own history masked | 3.26 | 3.38 | 3.57 | 3.88 | 4.21 |
| Europe (63 held out) | Inverse-distance of neighbours' last values | 3.16 | 3.48 | 3.89 | 4.24 | 4.42 |
| Europe (63 held out) | Inverse-distance of neighbours' forecasts | 3.08 | 3.22 | 3.47 | 3.73 | 4.02 |
| Asia (63 held out) | Graph model, own history masked | 5.41 | 5.48 | 5.56 | 5.79 | 6.00 |
| Asia (63 held out) | Inverse-distance of neighbours' last values | 6.09 | 6.31 | 6.59 | 6.71 | 6.93 |
| Asia (63 held out) | Inverse-distance of neighbours' forecasts | 5.87 | 5.90 | 5.89 | 6.08 | 6.31 |
<!-- results:unseen:end -->

**Reading.** 63 stations per region (15%) were removed from training, and at test time their own PM2.5
history is masked, so the model sees only their weather, position and neighbours. One seed. 61 of the 63 in
each region have a neighbour in range.

- **Asia:** the graph model is better than both interpolation baselines at every horizon (mean MAE over 24
  horizons 5.75, against 6.09 for inverse-distance weighting of the neighbours' forecasts and 6.73 for
  their last values).
- **Europe:** the graph model beats interpolation of last values on average (3.84 against 4.12, though not
  at 1 h: 3.26 against 3.16) and loses to
  interpolation of the neighbours' forecasts (3.68) at every reported horizon. In a dense network, averaging
  nearby forecasts is the better way to fill in a station the model has never seen.

Errors at unseen stations are about 60% (Europe) and 30% (Asia) higher than the main model's error over
all stations; the station sets differ, so this is a rough comparison.
P10 to P90 coverage at the held-out stations averages 80.1% in Europe and 79.1% in Asia.

### 5. Seeds

The graph-model rows above are the mean ± standard deviation over seeds 0, 1 and 2. Per-seed mean MAE is in
`results/main.json` under `mae_per_seed`.

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
- **Hyperparameter tuning.** Three trial runs were killed by a machine restart after one epoch. What they
  showed (validation pinball loss 0.299 to 0.302) was inside the noise. The model is effectively untuned.
- **A machine restart killed the first training batch** three hours into the build; nothing on disk was
  lost, but all in-flight runs were. Training now goes through a queue that skips finished runs.
- **Oracle-weather variant: not run.** It was optional and was dropped for time.
- **NASA image hosts** (`eoimages.gsfc.nasa.gov`) reset connections through the proxy; the texture comes from
  NASA GIBS instead.

## Limitations

- Three months of test data with no winter. PM2.5 peaks in winter in both regions; nothing here measures that.
- The replay in the app covers the last 56 days of the test period with forecasts issued every 6 hours.
  Reported metrics use every hourly origin of the full three months.
- "Asia" is Japan, Korea, India, Thailand, Taiwan, Laos, Hong Kong and a handful of others. China is nearly
  absent and India lost four months of training data.
- Asia's coverage threshold is 70%, lower than Europe's 80%.
- Weather inputs are reanalysis. A live system would have forecasts and slightly worse recent analyses.
- CAMS comparisons favour CAMS at long horizons (short-lead stitched series) and penalise it for being a grid
  average compared with a point; the two regions use different CAMS products.
- Low-cost sensors and reference monitors are mixed and cannot be told apart.
- Machine romanisation of Japanese, Korean, Chinese and Thai station names is rough.
- Frame rate could not be measured on real graphics hardware; see Verification.
- City labels come from the nearest GeoNames city, so a station near a border can carry a city from the
  other side (the watchlist shows "Shenzhen HK" for a Hong Kong station close to Shenzhen).

## Verification

| Check | Result |
|---|---|
| One-command re-evaluation | `make eval` rewrote `results/*.json`, the app data and the tables; `make check` reloads the shipped binaries and reproduces `results/replay_check.json` (all 10 values match). |
| Numbers in the app | The Methods page and the Terminal scoreboard import `results/*.json` at build time; no metric is typed into the interface. |
| Screenshots | `node qa/screens.cjs` writes all 7 views at 1440, 1024 and 390 px to `docs/screenshots/` (21 files), with no page errors. Each was looked at. Fixed as a result: scoreboard clipped at 1024 px, sideways overflow on the mobile terminal, chart labels colliding, table captions cut off on mobile. |
| Command bar | `node qa/commands.cjs`: every command, a typo ("MOVRS" suggests MOVERS), an unknown station and an unknown city behave as designed; history, autocomplete and number-key focus work. |
| Frame rate | `node qa/fps.cjs` → `results/frame_rate.json`: 1.22 frames per second in default mode and 1.49 in low-power mode at 1440×900. **This is Chromium's software renderer (SwiftShader) on a CPU with no GPU**, so it says nothing useful about a visitor's machine. Performance on real hardware is untested. The app switches itself to low-power mode when the average frame takes longer than 28 ms. |
| Colour and contrast | `ml/tools/cvd_check.py` and `ml/tools/contrast_check.py` write `results/colour_check.json` and `results/contrast_check.json`. |
| Design review | Done by hand from the screenshots at all three widths. |
| Repository hygiene | No keys, raw data or model checkpoints are committed. Largest committed file: 13 MB (`web/public/data/asia/fc.f16`). |
