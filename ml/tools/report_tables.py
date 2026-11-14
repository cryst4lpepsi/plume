"""Render the tables in README.md and REPORT.md from results/*.json, between the
<!-- results:NAME:start --> / <!-- results:NAME:end --> markers. Nothing in those blocks is typed by hand."""
import json, re
from pathlib import Path

R = Path("results")
J = lambda n: json.loads((R / f"{n}.json").read_text())
HS = (1, 3, 6, 12, 24)
NAMES = [("plume", "Plume graph model"), ("lightgbm", "LightGBM (no graph)"), ("persistence", "Persistence"),
         ("seasonal_naive", "Seasonal naive"), ("cams", "CAMS via Open-Meteo")]
REG = (("europe", "Europe"), ("asia", "Asia"))


def main_table(metric="mae"):
    m = J("main"); out = []
    for r, label in REG:
        t = m[r]["test"]
        out += [f"**{label}** ({metric.upper()}, µg/m³, test period; chosen model: {m[r]['chosen'].replace('plume_', '').replace('_', '-')})", "",
                "| Model | " + " | ".join(f"{h} h" for h in HS) + " | Skill vs persistence at 24 h |", "|---|" + "---:|" * (len(HS) + 1)]
        for k, name in NAMES:
            if k not in t:
                continue
            cells = []
            for h in HS:
                best = min(t[j][metric][h - 1] for j, _ in NAMES if j in t)
                v = f"{t[k][metric][h-1]:.2f}"
                sd = t[k].get(f"{metric}_sd")
                if sd:
                    v += f" ±{sd[h-1]:.2f}"
                cells.append(f"**{v}**" if t[k][metric][h - 1] == best else v)
            sk = "reference" if k == "persistence" else f"{t[k]['skill'][23]*100:+.1f}%"
            out.append(f"| {name} | " + " | ".join(cells) + f" | {sk if metric == 'mae' else ''} |")
        out.append("")
    return "\n".join(out)


def ablation_table():
    a = J("ablation"); g = J("graph"); out = []
    out += ["| Region | Variant | Seeds | Mean MAE over 24 horizons | 1 h | 6 h | 24 h | vs no graph |", "|---|---|---:|---:|---:|---:|---:|---:|"]
    for r, label in REG:
        t = a[r]["test"]
        for k, name in (("none", "No graph"), ("dist", "Distance-only edges"), ("wind", "Wind-aware edges")):
            x = t.get(k)
            if not x:
                continue
            rel = "reference" if k == "none" or not t.get("none") else f"{(x['mae_all']/t['none']['mae_all']-1)*100:+.2f}%"
            out.append(f"| {label} (median edge {g[r]['median_edge_km']:.0f} km) | {name} | {x['seeds']} | {x['mae_all']:.3f} ±{x['mae_all_sd']:.3f} | "
                       + " | ".join(f"{x['mae'][h-1]:.2f} ±{x['mae_sd'][h-1]:.2f}" for h in (1, 6, 24)) + f" | {rel} |")
    return "\n".join(out)


def calibration_table():
    c = J("calibration"); out = ["| Region | " + " | ".join(f"{h} h" for h in HS) + " | Mean over 24 h | Below P10 | Above P90 |", "|---|" + "---:|" * (len(HS) + 3)]
    for r, label in REG:
        if r not in c:
            continue
        x = c[r]; cov = x["coverage_p10_p90"]["mean"]; mean = lambda a: sum(a) / len(a)
        out.append(f"| {label} | " + " | ".join(f"{cov[h-1]*100:.1f}%" for h in HS) + f" | {mean(cov)*100:.1f}% | {mean(x['share_below_p10']['mean'])*100:.1f}% | {(1-mean(x['share_below_p90']['mean']))*100:.1f}% |")
    return "\n".join(out)


def unseen_table():
    u = J("unseen"); out = ["| Region | Method | " + " | ".join(f"{h} h" for h in HS) + " |", "|---|---|" + "---:|" * len(HS)]
    any_ = False
    for r, label in REG:
        if r not in u:
            continue
        any_ = True
        for k, name in (("graph_model_masked", "Graph model, own history masked"), ("idw_of_neighbour_last_obs", "Inverse-distance of neighbours' last values"),
                        ("idw_of_neighbour_forecasts", "Inverse-distance of neighbours' forecasts")):
            if k in u[r]:
                out.append(f"| {label} ({u[r]['held_out']} held out) | {name} | " + " | ".join(f"{u[r][k]['mae'][h-1]:.2f}" for h in HS) + " |")
    return "\n".join(out) if any_ else "_Not run._"


def quality_table():
    q = J("data_quality"); rows = [("Candidates downloaded", "candidates_downloaded"), ("PM2.5 rows read", "rows_pm25"), ("Negative rows dropped", "dropped_negative_rows"),
        ("Rows above 2,000 µg/m³ dropped", "dropped_over_2000_rows"), ("Flat-lined hours removed (run of 12 h or more)", "removed_flatline_hours"),
        ("Single-hour spikes removed", "removed_spike_hours"), ("Candidates at 80% coverage or better", "candidates_ge_80"),
        ("Coverage threshold used", "coverage_threshold"), ("Candidates passing", "candidates_ge_threshold"), ("Stations selected", "stations"),
        ("Median coverage of selected stations", "median_station_coverage"), ("Station-hours", "station_hours"), ("Observed", "observed_hours"),
        ("Filled by interpolation (gap of 3 h or less)", "interpolated_short_gap_hours"), ("Missing, masked in the loss", "missing_hours"), ("Names romanised", "transliterated_names")]
    f = lambda v: f"{v:,}" if isinstance(v, int) else (f"{v*100:.1f}%" if v <= 1 else f"{v:,.0f}")
    out = ["| | Europe | Asia |", "|---|---:|---:|"] + [f"| {n} | {f(q['europe'][k])} | {f(q['asia'][k])} |" for n, k in rows]
    for r, label in REG:
        out += ["", f"**{label}: coverage by country** (candidates downloaded / at 80% or better / at 70% or better / selected)", "",
                "| Country | Downloaded | ≥80% | ≥70% | Selected |", "|---|---:|---:|---:|---:|"]
        for c, v in q[r]["per_country_candidates"].items():
            out.append(f"| {c} | {v['downloaded']} | {v['ge80']} | {v['ge70']} | {q[r]['per_country'].get(c, 0)} |")
    return "\n".join(out)


BLOCKS = {"main": lambda: main_table("mae"), "rmse": lambda: main_table("rmse"), "ablation": ablation_table,
          "calibration": calibration_table, "unseen": unseen_table, "quality": quality_table}


def main():
    for f in ("README.md", "REPORT.md"):
        p = Path(f)
        if not p.exists():
            continue
        s = p.read_text()
        for name, fn in BLOCKS.items():
            pat = re.compile(rf"(<!-- results:{name}:start -->).*?(<!-- results:{name}:end -->)", re.S)
            if pat.search(s):
                s = pat.sub(lambda m: f"{m.group(1)}\n{fn()}\n{m.group(2)}", s)
        p.write_text(s)
        print("updated", f)

if __name__ == "__main__":
    main()
