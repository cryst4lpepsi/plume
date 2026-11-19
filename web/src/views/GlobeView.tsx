import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../App'
import { Globe } from '../globe/Globe'
import { type RegionKey } from '../lib/data'
import { stationValue } from '../lib/derive'
import { setState, useStore, useHour, type Mode, type RegionView } from '../lib/store'
import { fmt } from '../lib/pm'
import { LensNav, Segmented } from '../ui/bits'
import { Timeline } from '../ui/Timeline'
import { Legend } from '../ui/Legend'
import { Drawer } from '../ui/Drawer'
import { StationSearch } from '../ui/Search'
import { Wordmark } from '../ui/Loader'

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: 'observed', label: 'Observed', title: 'Measured PM2.5 at the replay time' },
  { value: 'forecast', label: 'Forecast', title: 'Median forecast for a later hour' },
  { value: 'error', label: 'Error', title: 'How far the forecast was from what was measured' },
  { value: 'influence', label: 'Influence', title: 'Which stations the model is listening to' },
]
const REGION_OPTS: { value: RegionView; label: string }[] = [{ value: 'europe', label: 'Europe' }, { value: 'asia', label: 'Asia' }, { value: 'india', label: 'India' }, { value: 'both', label: 'Both' }]
const MODE_NOTE: Record<Mode, (h: number) => string> = {
  observed: () => 'Measured values at the replay time. Areas far from any station stay dark.',
  forecast: (h) => `Median (P50) forecast for ${h} h after the replay time, from the latest 6-hourly issue.`,
  error: (h) => `Absolute error of the P50 forecast issued at least ${h} h earlier, against what was then measured.`,
  influence: () => 'Arcs show the graph edges the model weights most for this issue; they brighten toward the receiving station.',
}

export function GlobeView() {
  const ds = useData()
  const mode = useStore((s) => s.mode), region = useStore((s) => s.region), horizon = useStore((s) => s.horizon)
  const lowPower = useStore((s) => s.lowPower), lowAuto = useStore((s) => s.lowPowerAuto)
  const hour = useHour()
  const [hover, setHover] = useState<{ region: RegionKey; station: number; x: number; y: number } | null>(null)
  const onHover = useCallback((h: typeof hover) => setHover((p) => (p?.station === h?.station && p?.region === h?.region ? p : h)), [])
  const hv = hover ? stationValue(ds[hover.region], hover.station, hour, mode, horizon) : NaN
  return (
    <main className="globe-view">
      <Globe ds={ds} onHover={onHover} />
      <header className="g-title">
        <h1><Wordmark /></h1>
        <p>PM2.5 across Europe and Asia, forecast 24 hours ahead by a graph of monitoring stations.</p>
      </header>
      <div className="g-controls">
        <LensNav />
        <Segmented label="Layer" value={mode} options={MODES} onChange={(v) => setState({ mode: v })} />
        <Segmented label="Region" value={region} options={REGION_OPTS} onChange={(v) => setState({ region: v, sel: null })} />
        {(mode === 'forecast' || mode === 'error') && (
          <label className="g-horizon">
            <span>{mode === 'forecast' ? 'Hours ahead' : 'Forecast age'}</span>
            <input type="range" min={1} max={24} value={horizon} onChange={(e) => setState({ horizon: Number(e.target.value) })} />
            <output className="num">{horizon} h</output>
          </label>
        )}
        <p className="g-note">{MODE_NOTE[mode](horizon)}</p>
        <StationSearch />
      </div>
      <Legend />
      {hover && (
        <div className="g-tip" style={{ left: hover.x + 14, top: hover.y + 10 }} role="status">
          <strong>{ds[hover.region].stations[hover.station].name}</strong>
          <span>{ds[hover.region].stations[hover.station].city}, {ds[hover.region].stations[hover.station].iso}</span>
          <span className="num">{Number.isNaN(hv) ? 'no reading' : `${fmt(hv)} µg/m³${mode === 'error' ? ' error' : mode === 'forecast' ? ' P50' : ''}`}</span>
        </div>
      )}
      <Drawer />
      <footer className="g-foot">
        <Timeline />
        <p className="g-credits">
          <button type="button" className="link" aria-pressed={lowPower} onClick={() => setState({ lowPower: !lowPower, lowPowerAuto: false })}>
            Low-power rendering: {lowPower ? (lowAuto ? 'on (switched automatically, slow frames)' : 'on') : 'off'}
          </button>
          <span>Observations: EEA and OpenAQ, from many providers under their own licences. Fires: NASA FIRMS. Baseline: CAMS via Open-Meteo. Night lights: NASA Black Marble. Coastlines: Natural Earth. <Link to="/methods">Methods and sources</Link></span>
        </p>
      </footer>
    </main>
  )
}
