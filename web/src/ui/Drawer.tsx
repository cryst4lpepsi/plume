import { useEffect, useRef } from 'react'
import { useData } from '../App'
import { fcAt, hourToDate, lastObs, originHour, originIndex, upwind } from '../lib/data'
import { setState, useHour, useStore } from '../lib/store'
import { useSize } from '../lib/useSize'
import { StationChart } from '../charts/StationChart'
import { BANDS, bandIndex, bandText, fmt } from '../lib/pm'
import { IconClose, utc } from './bits'
import stationError from '@results/station_error.json'

type SE = Record<string, { model_mae: number[]; persistence_mae: number[]; n: number[] }>

/** Everything about one station. Shared by the globe drawer and the terminal detail panel. */
export function StationDetail({ dense }: { dense?: boolean }) {
  const ds = useData()
  const sel = useStore((s) => s.sel)
  const hour = useHour()
  const [ref, { w }] = useSize<HTMLDivElement>()
  if (!sel) return null
  const d = ds[sel.region], st = d.stations[sel.station], s = sel.station
  const now = lastObs(d, hour, s)
  const o = originIndex(d, hour), oh = originHour(d, o)
  let peak = { h: 1, p10: NaN, p50: -1, p90: NaN }
  for (let k = Math.max(1, hour - oh + 1); k <= d.horizons; k++) { const v = fcAt(d, o, s, k, 1); if (v > peak.p50) peak = { h: k, p10: fcAt(d, o, s, k, 0), p50: v, p90: fcAt(d, o, s, k, 2) } }
  const se = (stationError as unknown as SE)[sel.region]
  const mm = se?.model_mae[s], pm = se?.persistence_mae[s]
  const up = upwind(d, o, s).slice(0, dense ? 4 : 5)
  const band = Number.isFinite(now) ? bandIndex(now) : -1
  return (
    <div className={`detail${dense ? ' dense' : ''}`}>
      <header className="detail-head">
        <h2>{st.name}</h2>
        <p className="detail-place">{st.city}, {st.country} <span className="num">{Math.abs(st.lat).toFixed(2)}°{st.lat >= 0 ? 'N' : 'S'} {Math.abs(st.lon).toFixed(2)}°{st.lon >= 0 ? 'E' : 'W'}</span></p>
      </header>
      <div className="detail-now">
        <p className="big num" style={{ color: band >= 0 ? bandText(now) : undefined }}>{fmt(now)}<span className="unit"> µg/m³</span></p>
        <p className="detail-band">{band >= 0 ? <>Band {BANDS[band].label} µg/m³{now > 15 ? ', above the WHO 24 h guideline' : ', within the WHO 24 h guideline'}</> : 'No reading in the last 48 h'}</p>
        <p className="detail-fc">Next peak <span className="num">{fmt(peak.p50)}</span> µg/m³ (P10–P90 <span className="num">{fmt(peak.p10)}–{fmt(peak.p90)}</span>) at <span className="num">{utc(hourToDate(d, oh + peak.h), false)}</span> UTC</p>
      </div>
      <div ref={ref} className="detail-chart">{w > 0 && <StationChart d={d} s={s} hour={hour} width={w} height={dense ? 150 : 230} dense={dense} />}</div>
      <dl className="detail-facts">
        {Number.isFinite(mm) && Number.isFinite(pm) && se.n[s] > 0 && (
          <div>
            <dt>Test-period error here</dt>
            <dd><span className="num">{mm.toFixed(2)}</span> µg/m³ MAE for the model, <span className="num">{pm.toFixed(2)}</span> for persistence
              {' '}({mm < pm ? `${((1 - mm / pm) * 100).toFixed(0)}% lower` : `${((mm / pm - 1) * 100).toFixed(0)}% higher: persistence wins at this station`}).</dd>
          </div>
        )}
        <div>
          <dt>Stations the model weighted most</dt>
          <dd>
            {up.length === 0 ? 'No neighbour within range; this station is forecast from its own history.' : (
              <ol className="upwind">
                {up.map((u) => (
                  <li key={u.src}>
                    <button type="button" className="link" onClick={() => setState({ sel: { region: sel.region, station: u.src } })}>{d.stations[u.src].name}</button>
                    <span className="num">{Math.round(u.km)} km</span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(u.w * 100)}%` }} /></span>
                    <span className="num">{(u.w * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ol>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function Drawer() {
  const sel = useStore((s) => s.sel)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState({ sel: null }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])
  return (
    <aside ref={ref} className={`drawer${sel ? ' open' : ''}`} aria-label="Station detail" aria-hidden={!sel} inert={!sel}>
      <button type="button" className="icon-btn drawer-close" aria-label="Close station detail" onClick={() => setState({ sel: null })}><IconClose /></button>
      <StationDetail />
    </aside>
  )
}
