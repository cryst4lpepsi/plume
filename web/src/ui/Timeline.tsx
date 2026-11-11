import { useMemo, useRef } from 'react'
import { scaleLinear } from 'd3-scale'
import { line, area } from 'd3-shape'
import { useData } from '../App'
import { REGIONS, hourToDate, median, obsAt, originIndex, originHour, fcAt } from '../lib/data'
import { clockRange, inView } from '../lib/derive'
import { setState, useStore, useHour } from '../lib/store'
import { useSize } from '../lib/useSize'
import { IconPause, IconPlay, utc } from './bits'
import { WHO_24H } from '../lib/pm'

/** Full-width scrubber: station-median PM2.5 across the replay, solid behind "now", forecast band ahead of it. */
export function Timeline({ compact }: { compact?: boolean }) {
  const ds = useData()
  const view = useStore((s) => s.region), playing = useStore((s) => s.playing), speed = useStore((s) => s.speed)
  const hour = useHour()
  const frac = useStore((s) => s.hour)
  const [ref, { w }] = useSize<HTMLDivElement>()
  const h = compact ? 44 : 64
  const { min, max } = clockRange(ds)
  const series = useMemo(() => {
    const out: [number, number][] = []
    for (let t = min - 24; t <= max + 24; t++) {
      const v: number[] = []
      for (const r of REGIONS) if (inView(view, r)) for (let s = 0; s < ds[r].n; s++) v.push(obsAt(ds[r], t, s))
      out.push([t, median(v)])
    }
    return out
  }, [ds, view, min, max])
  const o = originIndex(ds.europe, hour)
  const band = useMemo(() => {
    const out: { t: number; p10: number; p50: number; p90: number }[] = []
    const oh = originHour(ds.europe, o)
    for (let k = 1; k <= 24; k++) {
      const q: number[][] = [[], [], []]
      for (const r of REGIONS) if (inView(view, r)) for (let s = 0; s < ds[r].n; s++) for (let j = 0; j < 3; j++) q[j].push(fcAt(ds[r], o, s, k, j))
      out.push({ t: oh + k, p10: median(q[0]), p50: median(q[1]), p90: median(q[2]) })
    }
    return out
  }, [ds, view, o])
  // scale to the 99th percentile so one spike does not flatten the rest of the replay; taller values clip at the top edge
  const top = useMemo(() => { const v = series.map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b); return Math.max(WHO_24H * 1.3, v[Math.floor(v.length * 0.99)] ?? 0) * 1.15 }, [series])
  const x = scaleLinear().domain([min, max + 24]).range([0, Math.max(1, w)])
  const y = scaleLinear().domain([0, top]).range([h - 2, 4]).clamp(true)
  const past = series.filter((p) => p[0] <= hour && p[0] >= min), future = series.filter((p) => p[0] >= hour)
  const ln = line<[number, number]>().defined((p) => Number.isFinite(p[1])).x((p) => x(p[0])).y((p) => y(p[1]))
  const ar = area<(typeof band)[number]>().x((p) => x(p.t)).y0((p) => y(p.p10)).y1((p) => y(p.p90))
  const bandNow = band.filter((b) => b.t >= hour)
  const drag = useRef(false)
  const seek = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    setState({ hour: Math.max(min, Math.min(max, Math.round(x.invert(clientX - r.left)))) })
  }
  const date = hourToDate(ds.europe, hour)
  // month/day ticks
  const ticks: number[] = []
  for (let t = min; t <= max; t++) { const d = hourToDate(ds.europe, t); if (d.getUTCHours() === 0 && (d.getUTCDate() === 1 || d.getUTCDate() === 15)) ticks.push(t) }
  return (
    <section className={`timeline${compact ? ' compact' : ''}`} aria-label="Replay timeline">
      <div className="tl-head">
        <button type="button" className="icon-btn" aria-label={playing ? 'Pause replay' : 'Play replay'} aria-pressed={playing} onClick={() => setState({ playing: !playing })}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <p className="tl-date">
          <span className="tl-replay">Replay</span>
          <time dateTime={date.toISOString()}>{utc(date)}</time>
        </p>
        <label className="tl-speed">
          <span>Speed</span>
          <select value={speed} onChange={(e) => setState({ speed: Number(e.target.value) })}>
            <option value={0.5}>30 min / s</option>
            <option value={2}>2 h / s</option>
            <option value={6}>6 h / s</option>
            <option value={24}>1 day / s</option>
          </select>
        </label>
        <p className="tl-note">Station median PM2.5, µg/m³. Line: observed. Band: P10 to P90 of the forecast issued {utc(hourToDate(ds.europe, originHour(ds.europe, o)), false)} UTC.</p>
      </div>
      <div className="tl-track" ref={ref}
        onPointerDown={(e) => { drag.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); seek(e.clientX, e.currentTarget) }}
        onPointerMove={(e) => drag.current && seek(e.clientX, e.currentTarget)}
        onPointerUp={() => (drag.current = false)}>
        {w > 0 && (
          <svg width={w} height={h + 14} aria-hidden="true">
            <line x1={0} x2={w} y1={y(WHO_24H)} y2={y(WHO_24H)} className="who" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={h - 2} y2={h + 2} className="tl-tick" />
                <text x={x(t) + 3} y={h + 12} className="tick">{hourToDate(ds.europe, t).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>
              </g>
            ))}
            <path d={ln(future) ?? ''} className="tl-future" />
            <path d={ar(bandNow) ?? ''} className="band" />
            <path d={ln(bandNow.map((b) => [b.t, b.p50] as [number, number])) ?? ''} className="p50" />
            <path d={ln(past) ?? ''} className="obs" />
            <line x1={x(frac)} x2={x(frac)} y1={0} y2={h} className="now" />
          </svg>
        )}
        <input type="range" className="tl-range" min={min} max={max} step={1} value={hour} aria-label="Replay time"
          aria-valuetext={utc(date)} onChange={(e) => setState({ hour: Number(e.target.value) })} />
      </div>
    </section>
  )
}
