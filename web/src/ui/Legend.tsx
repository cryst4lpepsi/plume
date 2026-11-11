import { BANDS } from '../lib/pm'
import { useStore } from '../lib/store'

/** Colour bands, highest at the top. Bands are anchored on the WHO guideline; they are not an official index. */
export function Legend() {
  const mode = useStore((s) => s.mode)
  if (mode === 'error') {
    return (
      <aside className="legend" aria-label="Colour legend: absolute forecast error">
        <h2>Absolute error<span>µg/m³</span></h2>
        <div className="legend-err" aria-hidden="true" />
        {/* square-root scale: tick position = sqrt(value / 75) */}
        <ul className="legend-err-ticks">{[[75, '75+'], [25, '25'], [5, '5'], [0, '0']].map(([v, t]) => <li key={t} style={{ bottom: `${Math.sqrt((v as number) / 75) * 100}%` }}>{t}</li>)}</ul>
        <p style={{ clear: 'both' }}>Square-root scale.</p>
      </aside>
    )
  }
  return (
    <aside className="legend" aria-label="Colour legend: PM2.5 bands">
      <h2>PM2.5<span>µg/m³</span></h2>
      <ol>
        {[...BANDS].reverse().map((b, i) => {
          const k = BANDS.length - 1 - i
          return (
            <li key={b.label} className={k === 2 ? 'who-edge' : ''}>
              <i className={k === 6 ? 'hatch' : ''} style={{ background: `var(--pm-${k})` }} />
              <span className="num">{b.label}</span>
              {k === 2 && <em>WHO 24 h guideline, 15</em>}
            </li>
          )
        })}
      </ol>
      <p>Bands, not an official index.</p>
    </aside>
  )
}
