"""Run the whole training suite, 4 jobs at a time, skipping anything already finished.
Safe to re-launch after an interruption: python -m plume.queue

Order: the baselines and a small set of tuning runs start first. Once the tuning runs have finished, one
setting is picked for both regions on validation loss and every remaining run uses it."""
import json, subprocess, sys, time
from pathlib import Path

R = {"eu": "europe", "as": "asia"}
RUNS = Path("data/runs")
TUNING = RUNS / "tuning.json"
# settings tried, each changing one thing from the base model (hidden 64, 2 layers, 6 epochs)
TUNE = {"base": [], "h128": ["--hidden", "128"], "l3": ["--layers", "3"], "e10": ["--epochs", "10"]}
MIN_GAIN = 0.01   # a costlier setting has to beat the base by this share of validation loss to be used


def job(tag, *args):
    return (tag, ["plume.train", "--tag", tag, *args], RUNS / f"{tag}.json")


def tune_jobs():
    """One short run per setting and region: wind edges, every 12th origin, no predictions kept."""
    return [job(f"{r}_tune_{k}", "--regions", R[r], "--mode", "wind", "--seed", "0", "--stride", "12", "--preds", "none", *extra)
            for k, extra in TUNE.items() for r in R]


def pick(scores):
    """scores: {setting: [best validation loss per region]}. The lowest mean wins, but only if it beats the
    base setting by MIN_GAIN; otherwise the base stays."""
    mean = {k: sum(v) / len(v) for k, v in scores.items()}
    best = min(mean, key=mean.get)
    return best if mean[best] < mean["base"] * (1 - MIN_GAIN) else "base"


def choose():
    scores = {k: [json.loads((RUNS / f"{r}_tune_{k}.json").read_text())["best_val"] for r in R] for k in TUNE}
    out = {"chosen": pick(scores), "min_gain": MIN_GAIN, "selected_on": "mean validation pinball loss over both regions",
           "settings": {k: {"args": TUNE[k], "val_loss": dict(zip(R.values(), v)), "mean": sum(v) / len(v)} for k, v in scores.items()}}
    TUNING.write_text(json.dumps(out))
    print("tuning: chosen", out["chosen"], {k: round(v["mean"], 4) for k, v in out["settings"].items()}, flush=True)
    return out["chosen"]


def final_jobs(extra):
    j = []
    def run(tag, *args):
        j.append(job(tag, *args, *extra))
    for r in R:
        run(f"{r}_wind_s0", "--regions", R[r], "--mode", "wind", "--seed", "0")
    run("sh_wind_s0", "--regions", "europe", "asia", "--mode", "wind", "--seed", "0")
    for r in R:   # second evaluation: trained on data to August 2025, tested on the following winter
        run(f"{r}_winter_s0", "--regions", R[r], "--mode", "wind", "--seed", "0", "--scheme", "winter")
    for mode in ("none", "dist"):
        for r in R:
            run(f"{r}_{mode}_s0", "--regions", R[r], "--mode", mode, "--seed", "0", "--preds", "test")
    for s in ("1", "2"):
        for r in R:
            run(f"{r}_wind_s{s}", "--regions", R[r], "--mode", "wind", "--seed", s)
            run(f"{r}_winter_s{s}", "--regions", R[r], "--mode", "wind", "--seed", s, "--scheme", "winter")
            for mode in ("none", "dist"):
                run(f"{r}_{mode}_s{s}", "--regions", R[r], "--mode", mode, "--seed", s, "--preds", "test")
    for s in ("1", "2"):
        run(f"sh_wind_s{s}", "--regions", "europe", "asia", "--mode", "wind", "--seed", s)
    for r in R:
        run(f"{r}_unseen_s0", "--regions", R[r], "--mode", "wind", "--seed", "0", "--unseen", "0.15", "--preds", "test")
    return j


def main(slots=4):
    RUNS.mkdir(parents=True, exist_ok=True); Path("data/logs").mkdir(parents=True, exist_ok=True)
    pending = lambda jobs: [x for x in jobs if not x[2].exists()]
    todo = pending([("baselines", ["plume.baselines"], Path("results/baselines.json"))])
    chosen = json.loads(TUNING.read_text())["chosen"] if TUNING.exists() else None
    todo += pending(final_jobs(TUNE[chosen])) if chosen else pending(tune_jobs())
    print(len(todo), "jobs to run" + ("" if chosen else " before the tuned suite"), flush=True)
    live = []
    while todo or live or chosen is None:
        live = [(t, p) for t, p in live if p.poll() is None]
        if chosen is None and not pending(tune_jobs()):
            chosen = choose()
            todo += pending(final_jobs(TUNE[chosen]))
        elif chosen is None and not todo and not live:
            sys.exit("a tuning run failed; see data/logs/*_tune_*.log")
        while todo and len(live) < slots:
            tag, cmd, _ = todo.pop(0)
            log = open(f"data/logs/{tag}.log", "w")
            live.append((tag, subprocess.Popen([sys.executable, "-m", *cmd], stdout=log, stderr=subprocess.STDOUT)))
            print(time.strftime("%H:%M:%S"), "start", tag, flush=True)
        time.sleep(10)
    print("queue finished", flush=True)

if __name__ == "__main__":
    main()
