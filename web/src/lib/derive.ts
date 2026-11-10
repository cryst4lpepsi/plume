// Derived quantities shared by both lenses. Everything here is computed from the exported arrays.
import { type RegionData, type RegionKey, REGIONS, obsAt, originIndex, originHour, fcAt, lastObs, median } from './data'
import type { Mode, RegionView } from './store'

export type DataSet = Record<RegionKey, RegionData>

export const clockRange = (ds: DataSet) => {
  const d = ds.europe
  return { min: d.originStart, max: d.originStart + (d.origins - 1) * d.originStep }
}
export const inView = (view: RegionView, r: RegionKey) => view === 'both' || view === r

/** Forecast issue used when scoring the present hour at a given lead: the latest issue at least `horizon` hours old. */
export function errorOrigin(d: RegionData, hour: number, horizon: number) {
  let o = originIndex(d, hour - horizon)
  if (hour - originHour(d, o) > d.horizons && o < d.origins - 1) o += 1
  const lead = hour - originHour(d, o)
  return lead >= 1 && lead <= d.horizons ? { o, lead } : null
}

/** Value the globe shows for one station at one hour under the current mode. NaN = nothing to show. */
export function stationValue(d: RegionData, s: number, hour: number, mode: Mode, horizon: number): number {
  if (mode === 'forecast') {
    const o = originIndex(d, hour)
    const lead = Math.min(d.horizons, Math.max(1, hour + horizon - originHour(d, o)))
    return fcAt(d, o, s, lead, 1)
  }
  if (mode === 'error') {
    const e = errorOrigin(d, hour, horizon)
    if (!e) return NaN
    const y = obsAt(d, hour, s)
    return Number.isNaN(y) ? NaN : Math.abs(fcAt(d, e.o, s, e.lead, 1) - y)
  }
  return obsAt(d, hour, s)
}

export function regionSummary(d: RegionData, hour: number) {
  const vals: number[] = []
  for (let s = 0; s < d.n; s++) { const v = obsAt(d, hour, s); if (!Number.isNaN(v)) vals.push(v) }
  const above = vals.filter((v) => v > 15).length
  return { median: median(vals), reporting: vals.length, shareAbove: vals.length ? above / vals.length : NaN }
}

export interface CityRow {
  key: string; region: RegionKey; ci: number; name: string; iso: string; major: boolean
  now: number; d6: number; p10: number; p50: number; p90: number; lead: number; dF: number; station: number
}
const cityMean = (_d: RegionData, st: number[], f: (s: number) => number) => {
  let sum = 0, k = 0
  for (const s of st) { const v = f(s); if (Number.isFinite(v)) { sum += v; k++ } }
  return k ? sum / k : NaN
}
/** City = mean of its stations. now, 6 h change, and the forecast `horizon` hours ahead from the latest issue. */
export function cityRows(ds: DataSet, hour: number, horizon: number, view: RegionView = 'both'): CityRow[] {
  const rows: CityRow[] = []
  for (const r of REGIONS) {
    if (!inView(view, r)) continue
    const d = ds[r]
    const o = originIndex(d, hour)
    const lead = Math.min(d.horizons, Math.max(1, hour + horizon - originHour(d, o)))
    d.cities.forEach((c, ci) => {
      const now = cityMean(d, c.stations, (s) => lastObs(d, hour, s))
      const prev = cityMean(d, c.stations, (s) => lastObs(d, hour - 6, s))
      const q = [0, 1, 2].map((k) => cityMean(d, c.stations, (s) => fcAt(d, o, s, lead, k)))
      rows.push({ key: `${r}:${ci}`, region: r, ci, name: c.name, iso: c.iso, major: c.major, now, d6: now - prev,
        p10: q[0], p50: q[1], p90: q[2], lead, dF: q[1] - now, station: c.stations[0] })
    })
  }
  return rows
}

export interface Alert { region: RegionKey; station: number; name: string; city: string; iso: string; threshold: number; lead: number; at: number; conf: 'likely' | 'possible'; now: number; p50: number }
const THRESHOLDS = [15, 25, 50, 75, 150]
/** Stations currently below a band edge whose latest forecast crosses it. "likely": P10 crosses; "possible": only P50. */
export function alerts(ds: DataSet, hour: number, view: RegionView = 'both'): Alert[] {
  const out: Alert[] = []
  for (const r of REGIONS) {
    if (!inView(view, r)) continue
    const d = ds[r]
    const o = originIndex(d, hour), oh = originHour(d, o)
    for (let s = 0; s < d.n; s++) {
      const now = lastObs(d, hour, s)
      if (Number.isNaN(now)) continue
      const th = THRESHOLDS.find((t) => t > now)
      if (th == null) continue
      for (let h = Math.max(1, hour - oh + 1); h <= d.horizons; h++) {
        const p50 = fcAt(d, o, s, h, 1)
        if (p50 >= th) {
          const st = d.stations[s]
          out.push({ region: r, station: s, name: st.name, city: st.city, iso: st.iso, threshold: th, lead: oh + h - hour, at: oh + h,
            conf: fcAt(d, o, s, h, 0) >= th ? 'likely' : 'possible', now, p50 })
          break
        }
      }
    }
  }
  return out.sort((a, b) => (a.conf === b.conf ? b.threshold - a.threshold || a.lead - b.lead : a.conf === 'likely' ? -1 : 1))
}
