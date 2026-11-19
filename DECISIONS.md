# Decisions

Judgement calls, one line of reasoning each. Newest at the bottom of each section.

## Setup
- **Fresh repository.** Plume lives at the repo root; an earlier unrelated prototype that shared the original repo was removed.
- **Python 3.13 venv, CPU-only PyTorch.** The container has 4 cores, 15 GB RAM, no GPU; model sizes are chosen for that.

## Data
- **Observations come from the OpenAQ AWS open-data archive** (`openaq-data-archive`, anonymous HTTPS listing and GET). No API key was available (`OPENAQ_API_KEY` unset), and the archive needs none.
- **Station discovery without the API.** The archive has no location index, so `ml/plume_data/discover.py` lists all 56,459 location prefixes, probes two months for activity, then reads one daily file per active location for coordinates and parameters.
- **Country, city, timezone are derived offline** from coordinates (Natural Earth 1:50m country polygons, GeoNames cities15000) because archive CSVs carry no country or provider field.
- **Region boxes.** Europe: 34 to 72°N, 25°W to 45°E. Asia: 11°S to 55°N, 60 to 150°E (South, South-East and East Asia; the Middle East is left out so the graph is not stretched across a data desert).
- **Period:** 2024-11-01 to 2026-10-31 UTC (24 complete months before the run date of 2026-11-14). Train 2024-11 to 2026-04, validation 2026-05 to 2026-07, test 2026-08 to 2026-10.
- **Shortlist before download.** Roughly 720 candidates per region are downloaded (about 1.07 M daily files) and the final 300 to 450 are picked after measuring real hourly coverage.
- **Country quotas.** Slots are allocated in proportion to (available stations)^p, p = 0.75 in Europe (keeps the dense German/French/Spanish networks dense) and p = 0.5 in Asia (stops Japan and Korea, with 1,000+ and 600+ stations, from taking the whole graph). Within a country, stations are chosen by farthest-point sampling so they spread out rather than stack in one city.
- **Values above 2,000 µg/m³ are treated as error codes** and dropped at parse time, together with negatives.

## Data (continued)
- **Asia coverage threshold lowered from 80 % to 70 %.** At 80 % Asia already has 387 candidates, so the original rule (lower it only if needed to reach 300) is not triggered. But at 80 % Japan and Korea are 41 % + of the pool and India is absent: OpenAQ's archive has no Indian (CPCB) files for Nov 2024 to Feb 2025, which caps every Indian station near 83 % before ordinary gaps. Spread across countries is also a goal; the two rules conflict, and spread was judged more important. The model masks missing hours in the loss.
- **Europe: every candidate was downloaded.** Day-file coverage overstated hourly coverage (a first 720-station shortlist left only 316 above 80 %; Spain has files for most days but few hours in them), so all 1,475 European candidates were fetched and 643 passed.
- **Weather and CAMS come from Open-Meteo's open-data bucket on AWS (`s3://openmeteo`, `.om` files), not the HTTP APIs.** The archive API returned "Daily API request limit exceeded" after about 15 full-period calls from this shared egress IP. Same underlying data (ERA5 0.25°, CAMS Europe 0.1°, CAMS global 0.4°), read with the `omfiles` package at the grid cell nearest each station. Grid orientation and time alignment were verified against API responses for Berlin and Delhi (exact match for CAMS; 0.02 °C mean difference for ERA5, which is rounding).
- **Relative humidity is derived** from ERA5 temperature and dew point (Magnus formula); the bucket has no RH variable.
- **CAMS global is served hourly by Open-Meteo** (the file metadata says 3600 s). The underlying product is 3-hourly, so the hourly values are Open-Meteo's interpolation; nothing further was interpolated here.
- **Spike rule floor.** "10x the rolling median" uses a 25 h centred median floored at 5 µg/m³; without a floor, clean-air readings of 1 to 2 µg/m³ would turn every 15 µg/m³ hour into a "spike".
- **Night-lights texture comes from NASA GIBS** (`VIIRS_Black_Marble` layer, WMS, 4096x2048). The direct NASA image hosts were unreachable through the proxy.
- **Station names:** 264 Asian names romanised (Hangul: hangul-romanize; Japanese: pykakasi Hepburn; Chinese-script names in TW/CN/HK: pypinyin without tones; Thai and others: unidecode). Machine romanisation is rough, especially for Thai and Japanese addresses; originals are kept in `data/processed/asia_transliterated.json`. City names come from GeoNames ASCII names.

## Data (more sources)
These were added after the first full run. The numbers in README.md and REPORT.md come from that run and do not use them yet.
- **Europe is also read straight from the EEA Air Quality Download Service** (`ml/plume_data/eea.py`, no key). OpenAQ carries only part of the EEA feed. Of 3,596 EEA sampling points in the Europe box, 1,328 have 80 % hourly coverage and data in the test months, against 643 from OpenAQ: Spain 187, Czechia 49, Italy 28, Sweden 18, where OpenAQ had almost none. EEA has no usable hourly series for the UK, Ireland, Turkey, Denmark or Hungary in this period, so OpenAQ stays for those.
- **Two EEA datasets are joined per sampling point:** verified (E1a) to the end of 2025 and up-to-date (E2a) from 2026. Rows with validity below 1 (invalid, maintenance) are dropped, then the same rules as OpenAQ apply. Daily (gravimetric) series are ignored; that is most of what Italy reports.
- **EEA hour label = the published End time.** On stations present in both sources, OpenAQ's hourly value equals the EEA value whose End is that hour (mean absolute difference 0.0 for FR, PL and FI), so both sources share one convention.
- **Same site, two sources.** Candidates within 100 m of each other count as one site and the one with the best coverage is kept (`drop_same_site` in `prepare.py`). This also removes twin instruments at one site, which would otherwise be near-copies in the graph.
- **EEA station ids** are 1,000,000,000 + CRC32 of the sampling point id (mod 10^9): stable, integer, and clear of OpenAQ's range.
- **The OpenAQ API has the same Indian gap as the archive.** Checked with a key: 25 of 25 sampled Indian sensors active in 2026 have no hours in December 2024. India's first winter cannot be recovered from OpenAQ.
- **Fires come from NASA FIRMS, VIIRS on NOAA-21, near-real-time stream** (`ml/plume_data/firms.py`). It is the only stream that covers the whole period from one satellite, so the feature does not change meaning between training and test. Low-confidence detections are dropped. Persistent industrial heat sources (flares, steel works) are not removed; they are constant and the model can learn to ignore them.
- **Fire features:** fire radiative power summed within 100 km and within 300 km of each station over the 24 h ending at each hour, as log1p(MW) / 5. Only past detections are used. The near-real-time stream is published about 3 h after the overpass; that delay is not modelled.
- **FIRMS needs a free key** (`FIRMS_MAP_KEY`). Without it the step is skipped and both features are zero, so the keyless pipeline still runs; `results/graph.json` records which case a run was.

## Evaluation (second round)

- **Europe grows to 700 stations; Asia stays at 420.** The EEA feed has 1,328 European sites at 80% coverage or better, so 420 was leaving most of the dense network unused. Asia is limited by the per-country quotas that keep Japan and Korea from crowding out everything else, not by the target. `TARGET` in `ml/plume_data/prepare.py`.
- **A second evaluation on winter.** The headline test stays August to October 2026, the cleanest months of the year. A second set of models is trained on data to August 2025, validated on September to November 2025 and tested on December 2025 to February 2026, when PM2.5 is highest. These models have ten months of training data and no full winter with Indian stations in it, so their errors are not comparable with the headline table; each model is compared with the baselines scored on the same hours. Splits `wtrain`, `wval`, `wtest` in `ml/plume/config.py`, results in `results/winter.json`.
- **One tuned setting for every run.** Four settings of the graph model (base; hidden 128; three layers; ten epochs) are trained once per region on every 12th origin and compared on validation loss. A costlier setting is used only if it beats the base by 1%; below that the difference is inside seed noise and not worth the training time. The pick, with every score, is in `results/tuning.json`. The test months play no part.
- **LightGBM is tuned too.** Three settings (the original; 127 leaves and 255 leaves with a lower learning rate and up to 500 trees) are compared on validation at 1, 6 and 24 h and the best one is fitted for all 24 horizons. A comparison where only the graph model was tuned would flatter it.
- **India and the EEA station types are reported as slices, not separate models.** Indian stations are scored inside the Asian model, and European background, traffic and industrial sites inside the European one (`results/slices.json`). OpenAQ stations in Europe carry no type and fall outside the three groups.
- **Ablation and unseen-station runs keep test predictions only.** Their validation predictions were never read, and with 700 stations each file is about 220 MB.

## Sharing the model

- **Weights ship with their inputs.** A bundle holds the weights, the station graph and the replay-window inputs, so a forecast can be checked against what was measured without the 60 GB data stage. Forecasting today's air needs live inputs, which is the separate daily-forecast job.
- **Bundles are not committed.** They go to a GitHub release, keeping the repository small.
- **The bundle step is outside `make eval`.** A failure there must not stop the results from being written; the notebook runs it as a separate step that may fail.

## Model
- **PM2.5 is modelled as log1p(x) minus a constant**, and forecasts are deltas from the last observed value. Quantiles survive the monotone transform, and both regions share one scale for the shared model.
- **Dynamic wind edge feature** = wind at the source station projected on the bearing to the destination, as three summaries (now, 6 h mean, 24 h mean), fed to the attention and gate MLPs. Per-step message passing inside the GRU would cost about 48x more.
- **Graph edges are directed in-edges from each station's 8 nearest neighbours** within 300 km (Europe) or 500 km (Asia). 2 European and 7 Asian stations have no neighbour in range and are forecast from their own history.
- **Light tuning was cut short.** Three one-epoch-old trial runs on Europe (2 vs 3 layers, lr 1e-3 vs 2e-3) were killed by a machine restart; validation pinball loss after epoch 1 was 0.2987 (2 layers, 2e-3), 0.3008 (2 layers, 1e-3), 0.3016 (3 layers, 2e-3). Differences are within noise, so the cheapest config was kept: hidden 64, 2 layers, lr 2e-3. No test data was involved.
- **Training budget:** 6 epochs over every 6th training hour (random phase per epoch), batch of 8 hours x all stations, single CPU thread per run, 4 runs in parallel. Runs go through a resumable queue so an interrupted machine picks up where it stopped (`python -m plume.queue`).
- **LightGBM:** 200 trees, lr 0.12, L1 objective on the log-delta target, one model per horizon (24 per region), trained on every 6th training hour.
- **Evaluation set:** every hourly origin in the split; a (origin, station, horizon) triple counts if the target hour was really observed (not gap-filled) and the station reported within 48 h before the origin. All models are scored on exactly these triples.

## Frontend
- **Forecast issues are exported every 6 h for the last 56 days of the test period** (220 issues, all 24 horizons, 3 quantiles) to keep the bundle under 50 MB; metrics still use every hourly origin of the full 3 months.
- **Terminal shortcuts are the digit keys 1 to 6, `/` and Space**, shown in each panel title, rather than F-keys: F5 and F1 belong to the browser.
- **The legend's top band and chart fills above 150 µg/m³ use a diagonal hatch**, so the most severe band reads without relying on colour.
- **Sparklines appear only in the watchlist**, where a trend at a glance helps; elsewhere they would be decoration.
- **Colour-vision check (`ml/tools/cvd_check.py`, `results/colour_check.json`).** Under Machado-2009 protan, deutan and tritan simulation and in greyscale, the seven-band ramp stays monotonic in OKLab lightness; the smallest step between neighbouring bands is 0.058 (protan) to 0.077 (normal), against a just-noticeable difference near 0.02. Rise/fall stay 0.11 (protan) to 0.23 apart and always carry an arrow and sign.

## Fonts
Proposals worked roles first (display, text, mono; fewest families that make the hierarchy unmistakable) and were drawn from open-licence faces on Fontsource.

**Screened out before testing** (overused defaults): Inter, Roboto and the other stock web faces, plus IBM Plex Sans/Mono (the stock "technical" pairing), Figtree and Instrument Sans (2025 template defaults), DM Mono, Cormorant, and Departure Mono (the current pixel-mono fashion).

**Three systems tested** on the same two screens with real data (`docs/fonts/globe-*.png`, `docs/fonts/terminal-*.png`, 1440 px; load any of them with `?fonts=a|b|c|f`):

| System | Display / text / mono | Looks hand-picked | Character | Terminal legibility | Pairing | Total |
|---|---|---|---|---|---|---|
| A | Spectral / Hanken Grotesk / Commit Mono | 4 | 4 | 4 | 4 | 16 |
| **B** | **Brygada 1918 / Golos Text / Iosevka** | **5** | **4** | **5** | **4** | **18** |
| C | Archivo (expanded) / Archivo / Azeret Mono | 3 | 3 | 3 | 4 | 13 |

Notes behind the scores:
- **A** is calm and correct. Spectral makes an elegant wordmark; Commit Mono is neutral to the point of anonymity and its dotted zero is faint at 11.5 px.
- **B** Brygada 1918 (a 1918 Polish text face revived in 2018) gives the wordmark and station names a slightly bookish, instrument-plate look that nothing else on the list has. Iosevka is narrow, so every table fits two more characters per column at a larger size, with a slashed zero and unmistakable 1/l/I. Golos Text is a quiet partner; its only weakness is that it is the least distinctive of the three roles.
- **C** One grotesque for everything reads as a house default rather than a choice, and Azeret Mono is wide enough that P10–P90 ranges crowd their column.
- The fallback (Newsreader / Schibsted Grotesk / Martian Mono) was shot for reference: Martian Mono is the widest mono of all and clipped the watchlist at 11.5 px.

**Critique of the best two (A and B).** Verdict: both hold hierarchy (wordmark, labels, data are distinguishable at a glance). B wins on the terminal, where the job is scanning numbers: denser, clearer figures, stronger weight contrast between 500 values and 400 context. A wins narrowly on the globe's intro sentence, where Hanken Grotesk is a little warmer than Golos. The terminal is the harder test, so **B is chosen** (5 on "looks hand-picked", 5 on "terminal legibility"; the threshold was 4 on both). The fallback was not needed.
- **Text contrast (`ml/tools/contrast_check.py`, `results/contrast_check.json`).** Every text token clears WCAG AA (4.5:1) on the three surfaces it sits on; the lowest pair is the tertiary grey on a selected row. The three darkest PM bands fail as text on ink, so numerals in those bands use lifted versions of the same hues (`--pmt-4` to `--pmt-6`); fills and the globe keep the true ramp.

## Final evaluation

- **The shared model is the reported model in both regions.** It had the lower validation MAE (Europe 2.406 against 2.427, Asia 4.911 against 4.932). The rule was fixed before the test numbers existed; `ml/plume/evaluate.py` applies it.
- **The ablation stays on per-region models.** Shared ablation variants would have needed six more 45-minute runs; the per-region ones answer the same question.
- **Unseen-station experiment ran with one seed.** Three seeds were budgeted for the main model and the ablation only.
- **Methods screenshots are stitched from viewport captures.** Software WebGL in the container wraps a single capture taller than 8,192 px.
- **Frame rate is reported as measured under software rendering**, labelled as such, because no GPU is available here.
- **A second frame-rate measurement on a real GPU** (`qa/fps.cjs --gpu`, a laptop RTX 3050 Ti at 144 Hz) was added later. It uses the installed Chrome in a visible window, because headless Chromium falls back to software rendering. The browser caps frames at the display rate, so the result shows the globe keeps up with a 144 Hz screen, not its ceiling.

## Second run (EEA stations, fires, tuning, winter)

- **The shared model is again the reported model in both regions.** Validation error: Europe 2.483 against 2.496 for the per-region model, Asia 4.819 against 4.863. Same rule as the first run, applied before the test numbers were read.
- **Ten epochs, chosen by the tuning stage.** It beat the base setting by 2.8% on validation loss, above the 1% bar, so every final run trained for ten epochs instead of six. That made the suite take three Kaggle sessions.
- **Winter numbers are reported as they came out.** The graph model's lead over LightGBM shrinks to 1.2% (Europe) and 0.6% (Asia), and LightGBM is better at Indian stations in winter. Both are stated in the README and the report rather than left to the tables.
- **The data-quality cleaning counts are marked "not recorded" for this run.** The data stage was restored from a checkpoint, so `prepare` did not run and its counts were never written. They are not carried over from the first run, which had different stations. Station-level figures are recomputed from the processed data (`ml/tools/quality_from_processed.py`), and `results/graph.json` from the exported app data (`ml/tools/graph_from_export.py`).
- **Kaggle checkpoints are `.ckpt` files fetched one by one.** Kaggle unpacks uploaded `.tar` files and will not send a large dataset as a single download; both cost a session before they were found.
- **LightGBM saves each finished horizon and uses two threads.** It is the longest job in the queue, and a 12-hour cutoff used to discard all of it.
