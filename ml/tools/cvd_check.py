"""Simulate colour-vision deficiency on the PM2.5 ramp and the rise/fall pair (Machado et al. 2009,
severity 1.0) and report OKLab lightness and neighbouring-step differences. Writes results/colour_check.json."""
import json
from pathlib import Path
import numpy as np

RAMP = [(0.9, 0.085, 176), (0.84, 0.13, 166), (0.8, 0.115, 96), (0.72, 0.15, 68), (0.62, 0.19, 40), (0.5, 0.2, 12), (0.385, 0.165, 18)]
PAIR = {"rise": (0.87, 0.085, 322), "fall": (0.71, 0.125, 236)}
M = {
    "protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}


def oklch_to_lin(l, c, h):
    a, b = c * np.cos(np.radians(h)), c * np.sin(np.radians(h))
    l_, m_, s_ = l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b
    L, Mm, S = l_ ** 3, m_ ** 3, s_ ** 3
    return np.clip([4.0767416621 * L - 3.3077115913 * Mm + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * Mm - 0.3413193965 * S,
                    -0.0041960863 * L - 0.7034186147 * Mm + 1.707614701 * S], 0, 1)


def lin_to_oklab(rgb):
    r, g, b = rgb
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.array([0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s])


def main():
    out = {"script": "ml/tools/cvd_check.py", "method": "Machado, Oliveira & Fernandes 2009, severity 1.0, applied in linear sRGB; differences are OKLab Euclidean distance (0.02 is roughly just noticeable)"}
    for name, mat in [("normal", np.eye(3))] + [(k, np.array(v)) for k, v in M.items()] + [("greyscale", None)]:
        labs = []
        for c in RAMP:
            rgb = oklch_to_lin(*c)
            if mat is None:
                y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; rgb = np.array([y, y, y])
            else:
                rgb = np.clip(mat @ rgb, 0, 1)
            labs.append(lin_to_oklab(rgb))
        L = [float(x[0]) for x in labs]
        steps = [float(np.linalg.norm(labs[i + 1] - labs[i])) for i in range(len(labs) - 1)]
        pr = [lin_to_oklab(np.clip((mat if mat is not None else np.eye(3)) @ oklch_to_lin(*PAIR[k]), 0, 1)) for k in ("rise", "fall")]
        if mat is None:
            pr = [np.array([p[0], 0, 0]) for p in pr]
        out[name] = {"ramp_lightness": [round(x, 3) for x in L], "lightness_monotonic": bool(all(L[i] > L[i + 1] for i in range(len(L) - 1))),
                     "min_adjacent_step": round(min(steps), 3), "adjacent_steps": [round(s, 3) for s in steps],
                     "rise_fall_distance": round(float(np.linalg.norm(pr[0] - pr[1])), 3), "rise_fall_lightness_gap": round(float(pr[0][0] - pr[1][0]), 3)}
        print(f"{name:9s} mono={out[name]['lightness_monotonic']} minstep={out[name]['min_adjacent_step']} L={out[name]['ramp_lightness']} rise/fall d={out[name]['rise_fall_distance']}")
    Path("results/colour_check.json").write_text(json.dumps(out, indent=1))

if __name__ == "__main__":
    main()
