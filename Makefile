# Plume: one command per stage. Everything runs from the repo root.
PY := PYTHONPATH=ml .venv/bin/python

.PHONY: setup data tensors train eval export report check web build

setup:            ## Python venv + web dependencies
	python3 -m venv .venv
	.venv/bin/pip install -q --upgrade pip
	.venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu
	.venv/bin/pip install -q -r ml/requirements.txt
	cd web && npm install

data:             ## download + clean observations, pick stations, extract ERA5 and CAMS (about 1 h, 60 GB transferred)
	$(PY) -m plume_data.fetch_geo
	$(PY) -m plume_data.discover
	$(PY) -m plume_data.meta
	$(PY) -m plume_data.coverage_list
	$(PY) -m plume_data.probe_extra
	$(PY) -m plume_data.shortlist
	$(PY) -m plume_data.download 0 1
	$(PY) -m plume_data.prepare
	$(PY) -m plume_data.om_fetch cams_europe
	$(PY) -m plume_data.om_fetch cams_global
	$(PY) -m plume_data.om_fetch copernicus_era5
	$(MAKE) tensors

tensors:          ## model-ready arrays and graphs
	$(PY) -m plume.data

train:            ## baselines + every graph-model run (resumable; about 2.5 h on 4 cores)
	$(PY) -m plume.queue

eval:             ## re-score every model from saved predictions, rewrite results/*.json, re-export and verify
	$(PY) -m plume.evaluate
	$(PY) -m plume.export
	$(PY) -m plume.check_export
	$(PY) ml/tools/report_tables.py

export:           ## frontend binaries
	$(PY) -m plume.export_geo
	$(PY) -m plume.export

report:           ## refresh the result tables in README.md and REPORT.md
	$(PY) ml/tools/report_tables.py

check:            ## reload the shipped binaries and reproduce results/replay_check.json
	$(PY) -m plume.check_export

web:              ## dev server
	cd web && npm run dev

build:            ## static site in web/dist
	cd web && npm run build
