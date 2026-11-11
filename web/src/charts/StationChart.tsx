import { useMemo } from 'react'
import { scaleLinear } from 'd3-scale'
import { line, area, curveMonotoneX } from 'd3-shape'
import { type RegionData, obsAt, originIndex, originHour, fcAt, lgbAt, lastObs, hourToDate } from '../lib/data'
import { useStore, setState } from '../lib/store'
import { WHO_24H } from '../lib/pm'

const PAST = 48
interface Props { d: RegionData; s: number; hour: number; width: number; height: number; dense?: boolean }

/** Observed vs forecast for one station: 48 h back, 24 h ahead, P10 to P90 band, optional baselines. */
export function StationChart({ d, s, hour, width, height, dense }: Props) {
  const bl = useStore((st) => st.baselines)
  const m = dense ? { t: 8, r: 8, b: 20, l: 30 } : { t: 12, r: 12, b: 26, l: 36 }
  const model = useMemo(() => {
    const o = originIndex(d, hour), oh = originHour(d, o)
    const past: [number, number][] = [], later: [number, number][] = []
    for (let h = hour - PAST; h <= hour; h++) past.push([h, obsAt(d, h, s)])
    for (let h = hour + 1; h <= oh + d.horizons; h++) later.push([h, obsAt(d, h, s)])
    const fc: { h: number; p10: number; p50: number; p90: number }[] = []
    for (let k = 1; k <= d.horizons; k++) fc.push({ h: oh + k, p10: fcAt(d, o, s, k, 0), p50: fcAt(d, o, s, k, 1), p90: fcAt(d, o, s, k, 2) })
    const anchor = lastObs(d, oh, s)
    const base = {
      persistence: fc.map((f) => [f.h, anchor] as [number, number]),
      seasonal: fc.map((f) => { const v = obsAt(d, f.h - 24, s); return [f.h, Number.isNaN(v) ? anchor : v] as [number, number] }),
      lightgbm: fc.map((f, k) => [f.h, lgbAt(d, o, s, k + 1)] as [number, number]),
      cams: fc.map((f) => [f.h, f.h < d.hours ? d.cams[f.h * d.n + s] : NaN] as [number, number]),
    }
    let top = WHO_24H * 1.4
    for (const [, v] of past) if (v > top) top = v
    for (const f of fc) if (f.p90 > top) top = f.p90
    for (const [, v] of later) if (v > top) top = v
    return { o, oh, past, later, fc, base, top: top * 1.08 }
  }, [d, s, hour])

  const x = scaleLinear().domain([hour - PAST, model.oh + d.horizons]).range([m.l, width - m.r])
  const y = scaleLinear().domain([0, model.top]).range([height - m.b, m.t]).nice(4)
  const ln = line<[number, number]>().defined((p) => Number.isFinite(p[1])).x((p) => x(p[0])).y((p) => y(p[1]))
  const band = area<{ h: number; p10: number; p90: number }>().x((p) => x(p.h)).y0((p) => y(p.p10)).y1((p) => y(p.p90)).curve(curveMonotoneX)
  const p50 = line<{ h: number; p50: number }>().x((p) => x(p.h)).y((p) => y(p.p50)).curve(curveMonotoneX)
  const ticksX: number[] = []
  for (let h = Math.ceil((hour - PAST) / 12) * 12; h <= model.oh + d.horizons; h += 12) ticksX.push(h)
  const fmtTick = (h: number) => { const t = hourToDate(d, h); return t.getUTCHours() === 0 ? `${t.getUTCDate()} ${t.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}` : `${String(t.getUTCHours()).padStart(2, '0')}:00` }
  const keys = ['persistence', 'seasonal', 'lightgbm', 'cams'] as const
  const names = { persistence: 'Persistence', seasonal: 'Same hour yesterday', lightgbm: 'LightGBM', cams: 'CAMS' }
  const dash = { persistence: '1 3', seasonal: '5 3', lightgbm: '2 2', cams: '8 3 1 3' }
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg width={width} height={height} role="img"
        aria-label={`PM2.5 at ${d.stations[s].name}: last 48 hours observed and the 24 hour forecast issued ${fmtTick(model.oh)} UTC with its P10 to P90 range`}>
        <clipPath id={`clip-${d.region}-${s}`}><rect x={m.l} y={m.t - 2} width={Math.max(0, width - m.l - m.r)} height={height - m.t - m.b + 4} /></clipPath>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {ticksX.map((h) => <text key={h} x={x(h)} y={height - m.b + (dense ? 13 : 16)} textAnchor="middle" className="tick">{fmtTick(h)}</text>)}
        <line x1={m.l} x2={width - m.r} y1={y(WHO_24H)} y2={y(WHO_24H)} className="who" />
        <text x={m.l + 4} y={y(WHO_24H) - 4} className="tick who-label">WHO 24 h guideline 15</text>
        <g clipPath={`url(#clip-${d.region}-${s})`}>
        <path d={band(model.fc) ?? ''} className="band" />
        {keys.map((k) => bl[k] && <path key={k} d={ln(model.base[k]) ?? ''} className="baseline" strokeDasharray={dash[k]} />)}
        <path d={ln(model.later) ?? ''} className="later" />
        <path d={p50(model.fc) ?? ''} className="p50" />
        <path d={ln(model.past) ?? ''} className="obs" />
        </g>
        <line x1={x(hour)} x2={x(hour)} y1={m.t} y2={height - m.b} className="now" />
        <text x={x(hour) + 4} y={m.t + 8} className="tick now-label">now</text>
        <line x1={x(model.oh)} x2={x(model.oh)} y1={height - m.b} y2={height - m.b + 5} className="now" />
      </svg>
      <figcaption className="chart-key">
        <span><i className="k k-obs" />Observed</span>
        <span><i className="k k-p50" />Forecast P50</span>
        <span><i className="k k-band" />P10–P90</span>
        <span><i className="k k-later" />Observed later (replay)</span>
        <span className="chart-toggles" role="group" aria-label="Baselines">
          {keys.map((k) => (
            <button key={k} type="button" className="toggle" aria-pressed={bl[k]} onClick={() => setState((st) => ({ baselines: { ...st.baselines, [k]: !st.baselines[k] } }))}>
              <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" className="baseline" strokeDasharray={dash[k]} /></svg>{names[k]}
            </button>
          ))}
        </span>
      </figcaption>
    </figure>
  )
}
