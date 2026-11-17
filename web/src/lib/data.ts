// Loads the precomputed replay: per-region index JSON plus Float16 binaries.
export type RegionKey = 'europe' | 'asia'
export const REGIONS: RegionKey[] = ['europe', 'asia']

export interface Station { id: number; name: string; city: string; iso: string; country: string; lat: number; lon: number; tz: string }
export interface City { name: string; iso: string; country: string; lat: number; lon: number; stations: number[]; major: boolean }
export interface RegionIndex {
  region: RegionKey
  label: string
  t0: string            // ISO UTC of hour 0 in obs/cams arrays
  hours: number         // length of obs/cams time axis
  leadIn: number        // hours before the first origin kept only as chart history
  originStart: number   // hour index of the first forecast origin
  originStep: number    // hours between forecast issues
  origins: number
  horizons: number
  stations: Station[]
  cities: City[]
  edges: [number, number, number][] // src, dst, km
  model: string
  baselineResolution: string
}
export interface RegionData extends RegionIndex {
  n: number
  obs: Float32Array    // [hours, n] NaN = missing
  cams: Float32Array   // [hours, n]
  wind: Int8Array      // [hours, n, 2] m/s * 8
  fc: Float32Array     // [origins, n, 24, 3]  P10 P50 P90
  lgb: Float32Array    // [origins, n, 24]
  att: Uint8Array      // [origins, edges] learned edge weight (attention x gate) * 255
  pos: Float32Array    // [n, 3] unit vectors
}

// IEEE 754 half -> float. Float16Array is not yet in every browser.
const f16table = (() => {
  const t = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023
    t[h] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024)
  }
  return t
})()
export function decodeF16(buf: ArrayBuffer): Float32Array {
  const u = new Uint16Array(buf)
  const out = new Float32Array(u.length)
  for (let i = 0; i < u.length; i++) out[i] = f16table[u[i]]
  return out
}

export function latLonToVec(lat: number, lon: number, r = 1): [number, number, number] {
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180
  // three.js sphere UV convention: lon 0 on +x toward -z rotation; matches the equirect Earth texture
  return [r * Math.cos(phi) * Math.cos(lam), r * Math.sin(phi), -r * Math.cos(phi) * Math.sin(lam)]
}

const base = import.meta.env.BASE_URL + 'data/'
const BINS = ['obs.f16', 'cams.f16', 'wind.i8', 'fc.f16', 'lgb.f16', 'att.u8'] as const

/** Reads a response body while reporting bytes. `size` is null when the length is unknown (or compressed). */
async function stream(p: string, onBytes: (got: number, size: number | null) => void): Promise<ArrayBuffer> {
  const r = await fetch(base + p)
  if (!r.ok) throw new Error(`Could not load ${p} (HTTP ${r.status}). Run "make export" to rebuild the data files.`)
  const len = Number(r.headers.get('content-length'))
  const size = len > 0 && !r.headers.get('content-encoding') ? len : null
  if (!r.body) { const b = await r.arrayBuffer(); onBytes(b.byteLength, size); return b }
  const reader = r.body.getReader(), parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); got += value.byteLength; onBytes(got, size)
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const v of parts) { out.set(v, at); at += v.byteLength }
  return out.buffer
}

/** Both regions, with download progress from 0 to 1 over the binary files (the bulk of the bytes). */
export async function loadAll(onProgress: (f: number) => void = () => {}): Promise<Record<RegionKey, RegionData>> {
  const idx = await Promise.all(REGIONS.map(async (region) => {
    const r = await fetch(base + `${region}/index.json`)
    if (!r.ok) throw new Error(`Could not load ${region}/index.json (HTTP ${r.status}). Run "make export" to rebuild the data files.`)
    return (await r.json()) as RegionIndex
  }))
  const files = REGIONS.flatMap((region) => BINS.map((f) => `${region}/${f}`))
  const got = files.map(() => 0), size: (number | null)[] = files.map(() => null), done = files.map(() => false)
  const report = () => {
    const known = size.filter((s): s is number => s != null)
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1
    let num = 0, den = 0
    files.forEach((_, i) => { const w = size[i] ?? avg; den += w; num += size[i] != null ? Math.min(got[i], w) : done[i] ? w : 0 })
    onProgress(den ? num / den : 0)
  }
  const bufs = await Promise.all(files.map((p, i) => stream(p, (g, s) => { got[i] = g; size[i] = s; report() }).then((b) => { done[i] = true; report(); return b })))
  const out = {} as Record<RegionKey, RegionData>
  REGIONS.forEach((region, k) => {
    const [obs, cams, wind, fc, lgb, att] = bufs.slice(k * BINS.length, (k + 1) * BINS.length)
    out[region] = build(idx[k], { obs, cams, wind, fc, lgb, att })
  })
  return out
}

function build(idx: RegionIndex, b: Record<'obs' | 'cams' | 'wind' | 'fc' | 'lgb' | 'att', ArrayBuffer>): RegionData {
  const { obs, cams, wind, fc, lgb, att } = b
  const n = idx.stations.length
  const pos = new Float32Array(n * 3)
  idx.stations.forEach((s, i) => pos.set(latLonToVec(s.lat, s.lon), i * 3))
  return {
    ...idx, n, pos,
    obs: decodeF16(obs), cams: decodeF16(cams), wind: new Int8Array(wind), fc: decodeF16(fc), lgb: decodeF16(lgb),
    att: new Uint8Array(att),
  }
}

// ---- accessors -------------------------------------------------------------------------------
export const obsAt = (d: RegionData, hour: number, s: number) =>
  hour < 0 || hour >= d.hours ? NaN : d.obs[hour * d.n + s]

/** Index of the latest forecast issue at or before `hour` (clamped). */
export function originIndex(d: RegionData, hour: number): number {
  return Math.max(0, Math.min(d.origins - 1, Math.floor((hour - d.originStart) / d.originStep)))
}
export const originHour = (d: RegionData, o: number) => d.originStart + o * d.originStep

/** Quantile q (0 P10, 1 P50, 2 P90) for station s, horizon h (1..24) from issue o. */
export const fcAt = (d: RegionData, o: number, s: number, h: number, q: number) =>
  d.fc[((o * d.n + s) * d.horizons + (h - 1)) * 3 + q]
export const lgbAt = (d: RegionData, o: number, s: number, h: number) => d.lgb[(o * d.n + s) * d.horizons + (h - 1)]

/** Forecast valid at `target` hour using the latest issue at or before `now`. NaN outside its 24 h reach. */
export function fcValid(d: RegionData, now: number, target: number, s: number, q: number): number {
  const o = originIndex(d, now)
  const h = target - originHour(d, o)
  return h >= 1 && h <= d.horizons ? fcAt(d, o, s, h, q) : NaN
}

/** Last observed value at or before `hour`, looking back up to 48 h (what persistence would use). */
export function lastObs(d: RegionData, hour: number, s: number): number {
  for (let k = 0; k < 48; k++) {
    const v = obsAt(d, hour - k, s)
    if (!Number.isNaN(v)) return v
  }
  return NaN
}

export const hourToDate = (d: RegionIndex, hour: number) => new Date(Date.parse(d.t0 + 'Z') + hour * 3600e3)

export function median(xs: number[]): number {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q)
  if (!a.length) return NaN
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** Stations feeding `s` in the graph, with the model's edge weight at issue o, strongest first. */
export function upwind(d: RegionData, o: number, s: number) {
  const E = d.edges.length, out: { src: number; km: number; w: number }[] = []
  for (let e = 0; e < E; e++) if (d.edges[e][1] === s) out.push({ src: d.edges[e][0], km: d.edges[e][2], w: d.att[o * E + e] / 255 })
  return out.sort((a, b) => b.w - a.w)
}
