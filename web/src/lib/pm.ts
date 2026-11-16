// PM2.5 bands and colour ramp. The same values feed CSS tokens, charts and the WebGL ramp texture.
export const BANDS = [
  { lo: 0, hi: 5, l: 0.9, c: 0.085, h: 176, label: '0–5' },
  { lo: 5, hi: 15, l: 0.84, c: 0.13, h: 166, label: '5–15' },
  { lo: 15, hi: 25, l: 0.8, c: 0.115, h: 96, label: '15–25' },
  { lo: 25, hi: 50, l: 0.72, c: 0.15, h: 68, label: '25–50' },
  { lo: 50, hi: 75, l: 0.62, c: 0.19, h: 40, label: '50–75' },
  { lo: 75, hi: 150, l: 0.5, c: 0.2, h: 12, label: '75–150' },
  { lo: 150, hi: Infinity, l: 0.385, c: 0.165, h: 18, label: '150+' },
] as const
export const WHO_24H = 15

export function bandIndex(v: number): number {
  for (let i = 0; i < BANDS.length; i++) if (v < BANDS[i].hi) return i
  return BANDS.length - 1
}
export const bandVar = (v: number) => `var(--pm-${bandIndex(v)})`
/** Band colour for numerals: same as the fill for bands 0 to 3, lifted for the three darkest so text keeps AA contrast. */
export const bandText = (v: number) => { const i = bandIndex(v); return `var(--pm${i >= 4 ? 't' : ''}-${i})` }

// OKLCH -> linear sRGB (Björn Ottosson's OKLab matrices)
export function oklchToLinear(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h), b = c * Math.sin(h)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
}
const gamma = (x: number) => {
  const v = Math.min(1, Math.max(0, x))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}
export function oklchToSrgb8(l: number, c: number, h: number): [number, number, number] {
  const [r, g, b] = oklchToLinear(l, c, h)
  return [Math.round(gamma(r) * 255), Math.round(gamma(g) * 255), Math.round(gamma(b) * 255)]
}

// Position on the ramp in [0,1]: piecewise-linear across band edges so the scale keeps resolving
// above 150 (parts of Asia sit there for days) instead of flattening.
const EDGES = [0, 5, 15, 25, 50, 75, 150, 400]
export function rampT(v: number): number {
  const x = Math.max(0, Math.min(v, 400))
  for (let i = 0; i < EDGES.length - 1; i++) {
    if (x <= EDGES[i + 1]) return (i + (x - EDGES[i]) / (EDGES[i + 1] - EDGES[i])) / (EDGES.length - 1)
  }
  return 1
}
/** Smoothly interpolated ramp colour (OKLCH between band centres) as sRGB bytes; used by the globe. */
export function rampColor(v: number): [number, number, number] {
  const t = rampT(v) * (BANDS.length) - 0.5
  const i = Math.max(0, Math.min(BANDS.length - 2, Math.floor(t)))
  const f = Math.max(0, Math.min(1, t - i))
  const a = BANDS[i], b = BANDS[i + 1]
  let dh = b.h - a.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return oklchToSrgb8(a.l + (b.l - a.l) * f, a.c + (b.c - a.c) * f, a.h + dh * f)
}
export const fmt = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? '–' : v.toFixed(v < 10 && d === 0 ? 1 : d)
