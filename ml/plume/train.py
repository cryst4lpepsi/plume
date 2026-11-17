"""Train one graph-model run and write its predictions.

python -m plume.train --tag eu_wind_s0 --regions europe --mode wind --seed 0
Outputs: data/runs/{tag}.pt, data/runs/{tag}.json (config, val curve, timing),
         data/preds/{region}_{split}_{tag}.npy  [O, N, 24, 3] float16 ug/m3 (val + test, see --preds)."""
import argparse, json, time
from pathlib import Path
import numpy as np
import torch
from .config import *
from .data import load, eval_mask, targets, git_commit
from .model import PlumeNet, pinball

RUNS, PRED = Path("data/runs"), Path("data/preds")


class Region:
    """Torch views of one region's tensors plus batch assembly."""
    def __init__(self, name, holdout=None, d=None):
        d = load(name) if d is None else d
        self.name, self.d = name, d
        self.X = torch.from_numpy(d["X"])
        self.zy = torch.from_numpy(np.nan_to_num(to_z(np.nan_to_num(d["pm"])))).float()
        self.obs = torch.from_numpy(d["observed"])
        self.anchor = torch.from_numpy(np.nan_to_num(d["anchor"]))
        self.has = torch.from_numpy(~np.isnan(d["anchor"])).float()
        self.age = torch.from_numpy(d["age"] / L_IN)
        self.wind = torch.from_numpy(d["wind"])
        self.static = torch.tensor(np.stack([d["lat"] / 90, d["lon"] / 180], 1), dtype=torch.float32)
        b = torch.from_numpy(d["bear"])
        self.g = dict(src=torch.from_numpy(d["src"]).long(), dst=torch.from_numpy(d["dst"]).long(),
                      e_static=torch.stack([torch.from_numpy(d["dist"]) / 300.0, torch.sin(b), torch.cos(b)], 1),
                      sinb=torch.sin(b), cosb=torch.cos(b))
        self.N = self.X.shape[1]
        self.holdout = torch.zeros(self.N, dtype=torch.bool)
        if holdout is not None:
            self.holdout[torch.as_tensor(holdout)] = True
        self.win = torch.arange(-L_IN + 1, 1)
        self.hz = torch.arange(1, HORIZON + 1)

    def batch(self, t, hide=None):
        """t: LongTensor of origins. hide: [B,N] bool nodes whose own history is masked out."""
        x = self.X[t[:, None] + self.win[None, :]].permute(0, 2, 1, 3)         # [B,N,L,F]
        anchor, has, age = self.anchor[t], self.has[t], self.age[t]
        if hide is not None:
            x = x.clone(); x[..., 0:2] = x[..., 0:2] * (~hide)[:, :, None, None]
            anchor, has = anchor * ~hide, has * ~hide
            age = torch.where(hide, torch.ones_like(age), age)
        idx = t[:, None] + self.hz[None, :]
        y, m = self.zy[idx].permute(0, 2, 1), self.obs[idx].permute(0, 2, 1)   # [B,N,24]
        return x, anchor, has, age, self.wind[t], y, m


def predict(model, R, t_all, hide_holdout=False, bs=16, want_edges=False):
    model.eval(); out, edges = [], []
    with torch.no_grad():
        for i in range(0, len(t_all), bs):
            t = torch.as_tensor(t_all[i:i + bs])
            hide = R.holdout[None, :].expand(len(t), -1) if hide_holdout else None
            x, anchor, has, age, wind, _, _ = R.batch(t, hide)
            q, w = model(x, R.static, anchor, has, age, R.g, wind)
            out.append(from_z(q.numpy()).astype(np.float32))
            if want_edges and w is not None:
                edges.append(w.numpy().astype(np.float16))
    return (np.concatenate(out), np.concatenate(edges) if edges else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True); ap.add_argument("--regions", nargs="+", default=["europe"])
    ap.add_argument("--mode", default="wind", choices=["none", "dist", "wind"])
    ap.add_argument("--seed", type=int, default=0); ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--hidden", type=int, default=64); ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--batch", type=int, default=8); ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--stride", type=int, default=6); ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--unseen", type=float, default=0.0, help="share of stations held out entirely (experiment 4)")
    ap.add_argument("--scheme", default="main", choices=list(SCHEMES), help="which train/val/test periods to use")
    ap.add_argument("--preds", default="all", choices=["all", "test", "none"], help="which predictions to keep")
    ap.add_argument("--max-steps", type=int, default=0, help="smoke-test limit")
    a = ap.parse_args()
    torch.set_num_threads(a.threads); torch.manual_seed(a.seed); rng = np.random.default_rng(a.seed)
    RUNS.mkdir(parents=True, exist_ok=True); PRED.mkdir(parents=True, exist_ok=True)
    regs = []
    for r in a.regions:
        hold = None
        if a.unseen > 0:
            n = load(r)["X"].shape[1]
            hold = np.random.default_rng(1234).choice(n, int(round(a.unseen * n)), replace=False)  # fixed across seeds
        regs.append(Region(r, hold))
    model = PlumeNet(a.hidden, a.layers, a.mode)
    n_par = sum(p.numel() for p in model.parameters())
    pre = SCHEMES[a.scheme]
    tr = origins(pre + "train"); va = origins(pre + "val")[::6]
    steps_per_epoch = sum(len(tr) // a.stride // a.batch for _ in regs)
    total = steps_per_epoch * a.epochs
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total, pct_start=0.1)
    t0, hist, best, step = time.time(), [], 1e9, 0

    def validate():
        model.eval(); tot = {}
        with torch.no_grad():
            for R in regs:
                num = den = 0.0
                for i in range(0, len(va), 16):
                    t = torch.as_tensor(va[i:i + 16])
                    hide = R.holdout[None, :].expand(len(t), -1) if a.unseen > 0 else None
                    x, anchor, has, age, wind, y, m = R.batch(t, hide)
                    q, _ = model(x, R.static, anchor, has, age, R.g, wind)
                    if a.unseen > 0:   # select on how well visible stations predict hidden training-era strangers
                        m = m & R.holdout[None, :, None]
                    else:
                        m = m & (has > 0)[:, :, None]
                    num += float(pinball(q, y, m) * m.sum()); den += float(m.sum())
                tot[R.name] = num / max(den, 1)
        return tot

    for ep in range(a.epochs):
        model.train()
        plan = []
        for k, R in enumerate(regs):
            o = tr[rng.integers(a.stride)::a.stride].copy(); rng.shuffle(o)
            plan += [(k, o[i:i + a.batch]) for i in range(0, len(o) - a.batch + 1, a.batch)][:len(tr) // a.stride // a.batch]
        rng.shuffle(plan)
        run = 0.0
        for k, t in plan:
            R = regs[k]; t = torch.as_tensor(t)
            hide = None
            if a.unseen > 0:
                # hold-out stations are always hidden and never in the loss; additionally hide a random 15 %
                # of the remaining stations each batch so the model learns to fill in strangers from neighbours
                hide = (torch.rand(len(t), R.N) < 0.15) | R.holdout[None, :]
            x, anchor, has, age, wind, y, m = R.batch(t, hide)
            if a.unseen > 0:
                m = m & ~R.holdout[None, :, None]
            q, _ = model(x, R.static, anchor, has, age, R.g, wind)
            loss = pinball(q, y, m)
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); step += 1; run += loss.item()
            if a.max_steps and step >= a.max_steps:
                print(f"smoke: {step} steps {time.time()-t0:.1f}s loss {run/step:.4f}"); return
        v = validate(); vm = float(np.mean(list(v.values())))
        hist.append(dict(epoch=ep + 1, train=run / len(plan), val=v, minutes=(time.time() - t0) / 60))
        print(a.tag, hist[-1], flush=True)
        if vm < best:
            best = vm; torch.save(model.state_dict(), RUNS / f"{a.tag}.pt")
    model.load_state_dict(torch.load(RUNS / f"{a.tag}.pt"))
    for R in regs:
        for split in {"all": (pre + "val", pre + "test"), "test": (pre + "test",), "none": ()}[a.preds]:
            p, _ = predict(model, R, origins(split), hide_holdout=a.unseen > 0)
            np.save(PRED / f"{R.name}_{split}_{a.tag}.npy", p.astype(np.float16))
    (RUNS / f"{a.tag}.json").write_text(json.dumps(dict(vars(a), params=n_par, history=hist, best_val=best,
        commit=git_commit(), train_minutes=(time.time() - t0) / 60,
        holdout={R.name: torch.where(R.holdout)[0].tolist() for R in regs} if a.unseen > 0 else None)))

if __name__ == "__main__":
    main()
