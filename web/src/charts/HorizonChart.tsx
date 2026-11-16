import { scaleLinear } from 'd3-scale'
import { line, area } from 'd3-shape'
import { useSize } from '../lib/useSize'

export interface Series { name: string; values: number[]; sd?: number[]; cls: string; dash?: string }
interface Props { series: Series[]; yLabel: string; height?: number; yDomain?: [number, number]; refLine?: { y: number; label: string }; format?: (v: number) => string; label: string }

/** Metric against forecast horizon (1 to 24 h). Lines are labelled at their right end, so no legend box. */
export function HorizonChart({ series, yLabel, height = 260, yDomain, refLine, format = (v) => v.toFixed(1), label }: Props) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const narrow = w > 0 && w < 520
  const m = { t: 28, r: narrow ? 124 : 150, b: 34, l: 44 }
  const all = series.flatMap((s) => s.values.map((v, i) => [v - (s.sd?.[i] ?? 0), v + (s.sd?.[i] ?? 0)]).flat()).filter(Number.isFinite)
  const dom = yDomain ?? [Math.min(...all, refLine?.y ?? Infinity), Math.max(...all, refLine?.y ?? -Infinity)]
  const pad = (dom[1] - dom[0]) * 0.06
  const x = scaleLinear().domain([1, 24]).range([m.l, Math.max(m.l + 10, w - m.r)])
  const y = scaleLinear().domain(yDomain ?? [dom[0] - pad, dom[1] + pad]).range([height - m.b, m.t]).nice(5)
  const ln = line<number>().defined((v) => Number.isFinite(v)).x((_, i) => x(i + 1)).y((v) => y(v))
  // spread end labels so they do not collide
  const clampY = (v: number) => Math.max(m.t, Math.min(height - m.b, y(v)))
  const ends = series.map((s, i) => ({ i, y: clampY(s.values[s.values.length - 1]) }))
  if (refLine) ends.push({ i: -1, y: clampY(refLine.y) }) // the reference label takes part in the spacing too
  ends.sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15
  const endY = new Map(ends.map((e) => [e.i, e.y]))
  return (
    <div ref={ref} className="hchart">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label}>
          {y.ticks(5).map((t) => (
            <g key={t}><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className="grid" /><text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{format(t)}</text></g>
          ))}
          {(narrow ? [1, 6, 12, 18, 24] : [1, 3, 6, 12, 18, 24]).map((h) => <text key={h} x={x(h)} y={height - m.b + 16} textAnchor="middle" className="tick">{h} h</text>)}
          <text x={m.l} y={height - 2} className="tick axis-label">Forecast horizon</text>
          <text x={m.l - 36} y={10} className="tick axis-label">{yLabel}</text>
          {refLine && (<><line x1={m.l} x2={w - m.r} y1={y(refLine.y)} y2={y(refLine.y)} className="refline" /><text x={w - m.r + 8} y={endY.get(-1)} dy="0.32em" className="tick">{refLine.label}</text></>)}
          <clipPath id={`hc-${label.length}-${series.length}`}><rect x={m.l} y={m.t} width={Math.max(0, w - m.l - m.r)} height={height - m.t - m.b} /></clipPath>
          <g clipPath={`url(#hc-${label.length}-${series.length})`}>
          {series.map((s) => s.sd && (
            <path key={s.name + 'sd'} className={`sd ${s.cls}`} d={area<number>().x((_, i) => x(i + 1)).y0((v, i) => y(v - s.sd![i])).y1((v, i) => y(v + s.sd![i]))(s.values) ?? ''} />
          ))}
          {series.map((s) => <path key={s.name} d={ln(s.values) ?? ''} className={`hline ${s.cls}`} strokeDasharray={s.dash} />)}
          </g>
          {series.map((s, i) => <text key={s.name} x={w - m.r + 8} y={endY.get(i)} dy="0.32em" className={`end-label ${s.cls}`}>{s.name}</text>)}
        </svg>
      )}
    </div>
  )
}
