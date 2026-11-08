"""Run the whole training suite, 4 jobs at a time, skipping anything already finished.
Safe to re-launch after an interruption: python -m plume.queue"""
import subprocess, sys, time
from pathlib import Path

R = {"eu": "europe", "as": "asia"}


def jobs():
    j = [("baselines", ["plume.baselines"], Path("results/baselines.json"))]
    def run(tag, *args):
        j.append((tag, ["plume.train", "--tag", tag, *args], Path(f"data/runs/{tag}.json")))
    for r in R:
        run(f"{r}_wind_s0", "--regions", R[r], "--mode", "wind", "--seed", "0")
    run("sh_wind_s0", "--regions", "europe", "asia", "--mode", "wind", "--seed", "0")
    for mode in ("none", "dist"):
        for r in R:
            run(f"{r}_{mode}_s0", "--regions", R[r], "--mode", mode, "--seed", "0")
    for s in ("1", "2"):
        for mode in ("wind", "none", "dist"):
            for r in R:
                run(f"{r}_{mode}_s{s}", "--regions", R[r], "--mode", mode, "--seed", s)
    for s in ("1", "2"):
        run(f"sh_wind_s{s}", "--regions", "europe", "asia", "--mode", "wind", "--seed", s)
    for r in R:
        run(f"{r}_unseen_s0", "--regions", R[r], "--mode", "wind", "--seed", "0", "--unseen", "0.15")
    return j


def main(slots=4):
    todo = [x for x in jobs() if not x[2].exists()]
    print(len(todo), "jobs to run", flush=True)
    Path("data/logs").mkdir(parents=True, exist_ok=True)
    live = []
    while todo or live:
        live = [(t, p) for t, p in live if p.poll() is None]
        while todo and len(live) < slots:
            tag, cmd, _ = todo.pop(0)
            log = open(f"data/logs/{tag}.log", "w")
            live.append((tag, subprocess.Popen([sys.executable, "-m", *cmd], stdout=log, stderr=subprocess.STDOUT)))
            print(time.strftime("%H:%M:%S"), "start", tag, flush=True)
        time.sleep(10)
    print("queue finished", flush=True)

if __name__ == "__main__":
    main()
