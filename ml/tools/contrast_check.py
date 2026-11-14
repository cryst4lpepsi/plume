"""WCAG 2 contrast ratios for every text colour token against the surfaces it is used on.
Writes results/contrast_check.json. AA needs 4.5:1 for normal text."""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cvd_check import oklch_to_lin

css = Path("web/src/styles/tokens.css").read_text()
tok = {m.group(1): tuple(float(x) for x in m.group(2).split()) for m in re.finditer(r"--([\w-]+):\s*oklch\(([\d.\s]+)\)", css)}
lum = lambda c: float(0.2126 * oklch_to_lin(*c)[0] + 0.7152 * oklch_to_lin(*c)[1] + 0.0722 * oklch_to_lin(*c)[2])
ratio = lambda a, b: (max(lum(a), lum(b)) + 0.05) / (min(lum(a), lum(b)) + 0.05)
TEXT = ["fg", "fg-2", "fg-3", "accent", "rise", "fall", "pm-0", "pm-1", "pm-2", "pm-3", "pmt-4", "pmt-5", "pmt-6"]
SURF = ["ink-0", "ink-1", "ink-2", "ink-3"]
out = {"script": "ml/tools/contrast_check.py", "aa_normal_text": 4.5, "pairs": {}}
worst = 99
for t in TEXT:
    row = {s: round(ratio(tok[t], tok[s]), 2) for s in SURF}
    out["pairs"][t] = row
    use = [row["ink-0"], row["ink-1"], row["ink-2"]]  # ink-3 is only a hover/flash fill under primary text
    worst = min(worst, *use)
    print(f"{t:7s}", row, "" if min(use) >= 4.5 else "  <-- below AA on a used surface")
out["pairs"]["accent-ink on accent"] = round(ratio(tok["accent-ink"], tok["accent"]), 2)
out["lowest_on_used_surfaces"] = worst
print("accent-ink on accent", out["pairs"]["accent-ink on accent"], "| lowest", worst)
Path("results/contrast_check.json").write_text(json.dumps(out, indent=1))
