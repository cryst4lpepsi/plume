import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useData } from '../App'
import { MiniGlobe } from '../globe/Globe'
import { REGIONS, hourToDate, obsAt, originHour, originIndex, type RegionKey } from '../lib/data'
import { alerts, cityRows, regionSummary, errorOrigin, REGION_NAME, stationValue, type CityRow, type DataSet } from '../lib/derive'
import { getState, setState, useHour, useStore, type RegionView } from '../lib/store'
import { bandText as bandVar, fmt } from '../lib/pm'
import { Delta, IconPause, IconPlay, LensNav, utc } from '../ui/bits'
import { StationDetail } from '../ui/Drawer'
import { Timeline } from '../ui/Timeline'
import { norm, searchStations, useStationIndex } from '../ui/Search'
import mainResults from '@results/main.json'

type Scores = Record<string, { mae: number[]; rmse: number[]; skill: number[]; mae_sd?: number[] }>
const RES = mainResults as unknown as Record<RegionKey, { chosen: string; test: Scores }> & { commit: string }
const MODEL_ROWS: [string, string][] = [['plume', 'Plume graph model'], ['lightgbm', 'LightGBM, no graph'], ['persistence', 'Persistence'], ['seasonal_naive', 'Same hour yesterday'], ['cams', 'CAMS via Open-Meteo']]
const PANELS = ['watch', 'movers', 'alerts', 'score', 'compare', 'detail'] as const
type PanelKey = (typeof PANELS)[number]
const PANEL_NAME: Record<PanelKey, string> = { watch: 'Watchlist', movers: 'Movers', alerts: 'Alerts', score: 'Scoreboard', compare: 'Region compare', detail: 'Detail' }

function Panel({ id, title, aside, children, className }: { id: PanelKey | 'globe'; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const k = PANELS.indexOf(id as PanelKey)
  return (
    <section id={`panel-${id}`} className={`panel p-${id} ${className ?? ''}`} tabIndex={-1} aria-labelledby={`ph-${id}`}>
      <header className="panel-head">
        <h2 id={`ph-${id}`}>{k >= 0 && <kbd>{k + 1}</kbd>}{title}</h2>
        {aside && <p>{aside}</p>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
/** Value that flashes briefly when it changes (remount restarts the CSS animation). */
const Val = ({ v, d = 0, band }: { v: number; d?: number; band?: boolean }) => {
  const t = fmt(v, d)
  return <span key={t} className="val flash" style={band && Number.isFinite(v) ? { color: bandVar(v) } : undefined}>{t}</span>
}
const pick = (r: CityRow) => setState({ sel: { region: r.region, station: r.station } })

function Spark({ ds, row, hour }: { ds: DataSet; row: CityRow; hour: number }) {
  const d = ds[row.region], st = d.cities[row.ci].stations
  const pts: [number, number][] = []
  for (let h = hour - 23; h <= hour; h++) { let s = 0, k = 0; for (const i of st) { const v = obsAt(d, h, i); if (!Number.isNaN(v)) { s += v; k++ } } pts.push([h, k ? s / k : NaN]) }
  const vals = pts.map((p) => p[1]).filter(Number.isFinite)
  if (vals.length < 2) return <svg width="64" height="16" aria-hidden="true" />
  const x = scaleLinear().domain([hour - 23, hour]).range([1, 63]), y = scaleLinear().domain([Math.min(...vals), Math.max(...vals) + 0.01]).range([14, 2])
  const p = line<[number, number]>().defined((q) => Number.isFinite(q[1])).x((q) => x(q[0])).y((q) => y(q[1]))(pts)
  return <svg width="64" height="16" className="spark" aria-hidden="true"><path d={p ?? ''} /></svg>
}

function usePins(rows: CityRow[]) {
  const [pins, setPins] = useState<string[]>(() => {
    try { const s = localStorage.getItem('plume.pins'); if (s) return JSON.parse(s) } catch { /* private mode */ }
    // default: the five most populous cities with a station in each region
    return (['asia', 'europe'] as const).flatMap((r) => rows.filter((x) => x.region === r && x.major).slice(0, 6).map((x) => `${r}:${x.name}`))
  })
  useEffect(() => { try { localStorage.setItem('plume.pins', JSON.stringify(pins)) } catch { /* ignore */ } }, [pins])
  const byName = useMemo(() => new Map(rows.map((r) => [`${r.region}:${r.name}`, r])), [rows])
  return { pins, setPins, pinned: pins.map((p) => byName.get(p)).filter(Boolean) as CityRow[] }
}

// ---- command bar -----------------------------------------------------------------------------
const COMMANDS: [string, string][] = [
  ['WATCH', 'Jump to the watchlist'], ['MOVERS', 'Jump to movers'], ['ALERTS', 'Jump to the alerts feed'], ['SCORE', 'Jump to the scoreboard'],
  ['COMPARE', 'Jump to region compare'], ['DETAIL', 'Jump to the detail panel'], ['HORIZON <1-24>', 'Set the forecast horizon in hours, e.g. HORIZON 12'],
  ['REGION <EUROPE|ASIA|INDIA|BOTH>', 'Limit movers, alerts and the mini globe to a region'], ['PIN <city>', 'Add a city to the watchlist'], ['UNPIN <city>', 'Remove a city from the watchlist'],
  ['PLAY', 'Run the replay clock'], ['PAUSE', 'Stop the replay clock'], ['GLOBE', 'Switch to the globe'], ['METHODS', 'Open the methods page'], ['HELP', 'Show this list'],
  ['<station or city>', 'Type any station or city name to select it'],
]
const VERBS = ['WATCH', 'MOVERS', 'ALERTS', 'SCORE', 'COMPARE', 'DETAIL', 'HORIZON', 'REGION', 'PIN', 'UNPIN', 'PLAY', 'PAUSE', 'GLOBE', 'METHODS', 'HELP']
function lev(a: string, b: string) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) m[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return m[a.length][b.length]
}
function focusPanel(k: PanelKey) {
  const el = document.getElementById(`panel-${k}`)
  if (!el) return
  el.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.focus({ preventScroll: true })
}

function CommandBar({ rows, pins, setPins }: { rows: CityRow[]; pins: string[]; setPins: (f: (p: string[]) => string[]) => void }) {
  const all = useStationIndex()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>({ text: 'Type a station, a city or a command. HELP lists them. Press / to focus.' })
  const [help, setHelp] = useState(false)
  const [active, setActive] = useState(0)
  const hist = useRef<string[]>([]), hi = useRef(-1)
  const input = useRef<HTMLInputElement>(null)
  const findCity = (name: string) => { const n = norm(name); return rows.find((r) => norm(r.name) === n) ?? rows.find((r) => norm(r.name).startsWith(n)) }
  const sugg = useMemo(() => {
    const t = q.trim()
    if (!t) return [] as { text: string; sub: string; run: string }[]
    const up = t.toUpperCase(), out: { text: string; sub: string; run: string }[] = []
    const [verb, ...rest] = up.split(/\s+/)
    if ((verb === 'PIN' || verb === 'UNPIN') && rest.length) {
      const n = norm(rest.join(' '))
      for (const r of rows) if (norm(r.name).startsWith(n) && (verb === 'PIN') !== pins.includes(`${r.region}:${r.name}`)) out.push({ text: `${verb} ${r.name}`, sub: r.iso, run: `${verb} ${r.name}` })
      return out.slice(0, 6)
    }
    for (const [c, d] of COMMANDS) if (c !== '<station or city>' && c.startsWith(verb) && !rest.length) out.push({ text: c, sub: d, run: c.split(' ')[0] + (c.includes('<') ? ' ' : '') })
    for (const h of searchStations(all, t, 6)) out.push({ text: h.label, sub: h.sub, run: `@${h.region}:${h.station}` })
    return out.slice(0, 8)
  }, [q, all, rows, pins])

  const run = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    hist.current.unshift(t.startsWith('@') ? q.trim() : t); hi.current = -1
    setQ(''); setHelp(false)
    const ok = (text: string) => setMsg({ text })
    const bad = (text: string) => setMsg({ text, bad: true })
    if (t.startsWith('@')) {
      const [r, s] = t.slice(1).split(':'); const region = r as RegionKey, station = Number(s)
      setState({ sel: { region, station } }); focusPanel('detail')
      return ok(`Selected ${all.find((h) => h.region === region && h.station === station)?.label}.`)
    }
    const [verb, ...rest] = t.toUpperCase().split(/\s+/), arg = rest.join(' '), argRaw = t.split(/\s+/).slice(1).join(' ')
    const panels: Record<string, PanelKey> = { WATCH: 'watch', MOVERS: 'movers', ALERTS: 'alerts', SCORE: 'score', COMPARE: 'compare', DETAIL: 'detail' }
    if (panels[verb] && !arg) { focusPanel(panels[verb]); return ok(`${PANEL_NAME[panels[verb]]} in focus.`) }
    if (verb === 'HELP') { setHelp(true); return ok('Commands are listed above. Esc closes the list.') }
    if (verb === 'HORIZON') {
      const n = Number(arg)
      if (!Number.isInteger(n) || n < 1 || n > 24) return bad(`HORIZON needs a whole number of hours from 1 to 24, for example HORIZON 12. Got ${argRaw ? `“${argRaw}”` : 'no number'}.`)
      setState({ horizon: n }); return ok(`Horizon set to ${n} h. Scoreboard, watchlist and movers now use it.`)
    }
    if (verb === 'REGION') {
      const m: Record<string, RegionView> = { EUROPE: 'europe', EU: 'europe', ASIA: 'asia', INDIA: 'india', IN: 'india', BOTH: 'both', ALL: 'both' }
      if (!m[arg]) return bad(`REGION takes EUROPE, ASIA, INDIA or BOTH. Got “${arg || 'nothing'}”.`)
      setState({ region: m[arg] }); return ok(`Region set to ${m[arg].toUpperCase()}.`)
    }
    if (verb === 'PIN' || verb === 'UNPIN') {
      const c = findCity(arg)
      if (!c) return bad(`No city called “${argRaw}” in the data. Try a city that has a station, such as Seoul or Warsaw.`)
      const key = `${c.region}:${c.name}`
      if (verb === 'PIN') { if (pins.includes(key)) return ok(`${c.name} is already on the watchlist.`); setPins((p) => [...p, key]); return ok(`${c.name} added to the watchlist.`) }
      if (!pins.includes(key)) return bad(`${c.name} is not on the watchlist.`)
      setPins((p) => p.filter((x) => x !== key)); return ok(`${c.name} removed from the watchlist.`)
    }
    if (verb === 'PLAY') { setState({ playing: true }); return ok('Replay running.') }
    if (verb === 'PAUSE') { setState({ playing: false }); return ok('Replay paused. Every panel holds at this hour.') }
    if (verb === 'GLOBE') return nav('/')
    if (verb === 'METHODS') return nav('/methods')
    const hit = searchStations(all, t, 1)[0]
    if (hit) { setState({ sel: { region: hit.region, station: hit.station } }); focusPanel('detail'); return ok(`Selected ${hit.label}, ${hit.sub}.`) }
    const near = VERBS.map((v) => [lev(verb, v), v] as const).sort((a, b) => a[0] - b[0])[0]
    if (near[0] <= 2) return bad(`Unknown command “${t}”. Did you mean ${near[1]}? HELP lists every command.`)
    bad(`No station, city or command matches “${t}”. Names are Latin script, for example Delhi or Krakow. HELP lists commands.`)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus() }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); focusPanel(PANELS[Number(e.key) - 1]) }
      if (!typing && e.key === ' ') { e.preventDefault(); setState({ playing: !getState().playing }) }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="cmd">
      {help && (
        <div className="cmd-help" role="region" aria-label="Command list">
          <table><tbody>{COMMANDS.map(([c, d]) => <tr key={c}><th scope="row">{c}</th><td>{d}</td></tr>)}
            <tr><th scope="row">1 to 6</th><td>Focus a panel (numbers are shown in each panel title)</td></tr>
            <tr><th scope="row">/ · Space · ↑</th><td>Focus the command bar · play or pause · recall earlier commands</td></tr></tbody></table>
        </div>
      )}
      {!help && sugg.length > 0 && (
        <ul className="cmd-sugg" id="cmd-sugg" role="listbox" aria-label="Suggestions">
          {sugg.map((s, i) => (
            <li key={s.text + i} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); if (s.run.endsWith(' ')) { setQ(s.run); input.current?.focus() } else run(s.run) }}>
              <span>{s.text}</span><span>{s.sub}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="cmd-line" onSubmit={(e) => { e.preventDefault(); const s = sugg[active]; const typed = q.trim().toUpperCase(); if (s && !VERBS.includes(typed.split(/\s+/)[0]) && s.run.startsWith('@')) run(s.run); else run(q) }}>
        <label htmlFor="cmd-in" aria-hidden="true">&gt;</label>
        <input id="cmd-in" ref={input} value={q} autoComplete="off" spellCheck={false} aria-label="Command bar: station, city or command" role="combobox" aria-expanded={sugg.length > 0} aria-controls="cmd-sugg"
          placeholder="City, station or command"
          onChange={(e) => { setQ(e.target.value); setActive(0); hi.current = -1; setHelp(false) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); if (sugg.length && q && hi.current < 0) setActive((a) => Math.max(0, a - 1)); else if (hist.current.length) { hi.current = Math.min(hist.current.length - 1, hi.current + 1); setQ(hist.current[hi.current]) } }
            if (e.key === 'ArrowDown') { e.preventDefault(); if (hi.current >= 0) { hi.current -= 1; setQ(hi.current >= 0 ? hist.current[hi.current] : '') } else setActive((a) => Math.min(sugg.length - 1, a + 1)) }
            if (e.key === 'Tab' && sugg[active] && q) { e.preventDefault(); setQ(sugg[active].run.startsWith('@') ? sugg[active].text : sugg[active].run) }
            if (e.key === 'Escape') { setQ(''); setHelp(false); (e.target as HTMLElement).blur() }
          }} />
        <p className={`cmd-msg${msg.bad ? ' bad' : ''}`} role="status" aria-live="polite">{msg.text}</p>
      </form>
    </div>
  )
}

// ---- view ------------------------------------------------------------------------------------
export default function TerminalView() {
  const ds = useData()
  const hour = useHour()
  const horizon = useStore((s) => s.horizon), region = useStore((s) => s.region), playing = useStore((s) => s.playing), sel = useStore((s) => s.sel)
  const rowsAll = useMemo(() => cityRows(ds, hour, horizon, 'both'), [ds, hour, horizon])
  const rows = useMemo(() => rowsAll.filter((r) => region === 'both' || r.region === region || (region === 'india' && r.iso === 'IN')), [rowsAll, region])
  const { pins, setPins, pinned } = usePins(rowsAll)
  const al = useMemo(() => alerts(ds, hour, region), [ds, hour, region])
  const valid = rows.filter((r) => Number.isFinite(r.d6) && Number.isFinite(r.now))
  const up6 = [...valid].sort((a, b) => b.d6 - a.d6).slice(0, 4), dn6 = [...valid].sort((a, b) => a.d6 - b.d6).slice(0, 4)
  const validF = rows.filter((r) => Number.isFinite(r.dF))
  const upF = [...validF].sort((a, b) => b.dF - a.dF).slice(0, 4), dnF = [...validF].sort((a, b) => a.dF - b.dF).slice(0, 4)
  const ticker = rowsAll.filter((r) => r.major && Number.isFinite(r.now))
  const date = hourToDate(ds.europe, hour)
  const issue = hourToDate(ds.europe, originHour(ds.europe, originIndex(ds.europe, hour)))
  useEffect(() => { if (!getState().sel) { const d = rowsAll.find((r) => r.region === 'asia' && r.major) ?? rowsAll[0]; if (d) pick(d) } }, []) // eslint-disable-line
  const moverTable = (title: string, list: CityRow[], key: 'd6' | 'dF') => (
    <table className="tt">
      <caption>{title}</caption>
      <tbody>
        {list.map((r) => (
          <tr key={r.key} onClick={() => pick(r)}>
            <th scope="row"><button type="button" className="rowbtn" onClick={() => pick(r)}>{r.name}</button><span className="iso">{r.iso}</span></th>
            <td><Val v={key === 'd6' ? r.now : r.p50} band /></td>
            <td><Delta v={r[key]} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  const tickerItems = ticker.map((r) => (
    <li key={r.key}><button type="button" className="rowbtn" onClick={() => pick(r)}>{r.name}</button><Val v={r.now} band /><Delta v={r.d6} /></li>
  ))
  return (
    <main className="term">
      <header className="term-head">
        <h1>Plume<span>terminal</span></h1>
        <LensNav />
        <div className="term-clock">
          <button type="button" className="icon-btn" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => setState({ playing: !playing })}>{playing ? <IconPause /> : <IconPlay />}</button>
          <span className="tl-replay">Replay</span>
          <time dateTime={date.toISOString()}>{utc(date)}</time>
        </div>
        <dl className="term-status">
          <div><dt>Issue</dt><dd className="num">{utc(issue, false)} UTC</dd></div>
          <div><dt>Horizon</dt><dd className="num">{horizon} h</dd></div>
          <div><dt>Region</dt><dd>{REGION_NAME[region]}</dd></div>
        </dl>
      </header>
      <div className="ticker" aria-label="City ticker: PM2.5 now in µg/m³ and change over 6 hours">
        <ul className="ticker-run">{tickerItems}</ul>
        <ul className="ticker-run" aria-hidden="true">{tickerItems}</ul>
      </div>
      <div className="term-grid">
        <Panel id="watch" title="Watchlist" aside={`µg/m³ · forecast +${horizon} h`}>
          <table className="tt watch">
            <thead><tr><th scope="col">City</th><th scope="col" className="sp">24 h</th><th scope="col">Now</th><th scope="col">Δ 6 h</th><th scope="col">P50</th><th scope="col">P10–P90</th><th scope="col"><span className="sr-only">Unpin</span></th></tr></thead>
            <tbody>
              {pinned.length === 0 && <tr><td colSpan={7} className="empty">Nothing pinned. Type PIN and a city name in the command bar, for example PIN Seoul.</td></tr>}
              {pinned.map((r) => (
                <tr key={r.key} className={sel && sel.region === r.region && ds[r.region].cities[r.ci].stations.includes(sel.station) ? 'on' : ''}>
                  <th scope="row"><button type="button" className="rowbtn" onClick={() => pick(r)}>{r.name}</button><span className="iso">{r.iso}</span></th>
                  <td className="sp"><Spark ds={ds} row={r} hour={hour} /></td>
                  <td><Val v={r.now} band /></td>
                  <td><Delta v={r.d6} /></td>
                  <td><Val v={r.p50} band /></td>
                  <td className="range">{fmt(r.p10)}–{fmt(r.p90)}</td>
                  <td><button type="button" className="unpin" aria-label={`Unpin ${r.name}`} onClick={() => setPins((p) => p.filter((x) => x !== `${r.region}:${r.name}`))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel id="movers" title="Movers" aside="cities, µg/m³">
          <div className="movers">
            {moverTable('Rising, last 6 h', up6, 'd6')}
            {moverTable('Falling, last 6 h', dn6, 'd6')}
            {moverTable(`Forecast to rise, next ${rows[0]?.lead ?? horizon} h`, upF, 'dF')}
            {moverTable(`Forecast to fall, next ${rows[0]?.lead ?? horizon} h`, dnF, 'dF')}
          </div>
        </Panel>
        <Panel id="detail" title="Detail" aside={sel ? `${sel.region === 'europe' ? 'Europe' : 'Asia'} graph` : undefined}>
          {sel ? <StationDetail dense /> : <p className="empty">No station selected. Type a city or station name in the command bar, or pick a row in any panel.</p>}
        </Panel>
        <Panel id="score" title="Scoreboard" aside={`test period · MAE µg/m³ at +${horizon} h · skill vs persistence`}>
          <table className="tt score">
            <thead><tr><th scope="col">Model</th>{REGIONS.map((r) => <th key={r} scope="colgroup" colSpan={2}>{r === 'europe' ? 'Europe' : 'Asia'}</th>)}</tr></thead>
            <tbody>
              {MODEL_ROWS.map(([k, name]) => (
                <tr key={k} className={k === 'plume' ? 'ours' : ''}>
                  <th scope="row">{name}</th>
                  {REGIONS.map((r) => {
                    const t = RES[r].test, m = t[k]
                    if (!m) return [<td key={r}>–</td>, <td key={r + 's'} />]
                    const best = MODEL_ROWS.map(([j]) => t[j]?.mae[horizon - 1] ?? Infinity)
                    const win = m.mae[horizon - 1] === Math.min(...best)
                    return [
                      <td key={r} className={win ? 'win' : ''}>{m.mae[horizon - 1].toFixed(2)}{m.mae_sd ? <small> ±{m.mae_sd[horizon - 1].toFixed(2)}</small> : null}{win && <em>best</em>}</td>,
                      <td key={r + 's'} className="skill">{k === 'persistence' ? 'ref' : `${m.skill[horizon - 1] >= 0 ? '+' : '−'}${Math.abs(m.skill[horizon - 1] * 100).toFixed(0)}%`}</td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="foot">Read from results/main.json (commit {RES.commit}). CAMS is a stitched short-lead series, not a true {horizon} h forecast, and its grid is 0.1° in Europe but 0.4° in Asia.</p>
        </Panel>
        <Panel id="compare" title="Region compare" aside="now, observed">
          <table className="tt compare">
            <thead><tr><th scope="col"><span className="sr-only">Measure</span></th><th scope="col">Europe</th><th scope="col">Asia</th></tr></thead>
            <tbody>
              {(() => {
                const s = { europe: regionSummary(ds.europe, hour), asia: regionSummary(ds.asia, hour) }
                const live = (r: RegionKey) => { const e = errorOrigin(ds[r], hour, horizon); if (!e) return NaN; const v: number[] = []; for (let i = 0; i < ds[r].n; i++) { const x = stationValue(ds[r], i, hour, 'error', horizon); if (!Number.isNaN(x)) v.push(x) } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN }
                return (<>
                  <tr><th scope="row">Median PM2.5, µg/m³</th>{REGIONS.map((r) => <td key={r}><Val v={s[r].median} d={1} band /></td>)}</tr>
                  <tr><th scope="row">Stations above WHO 15</th>{REGIONS.map((r) => <td key={r}><Val v={s[r].shareAbove * 100} /> %</td>)}</tr>
                  <tr><th scope="row">Stations reporting</th>{REGIONS.map((r) => <td key={r}>{s[r].reporting} / {ds[r].n}</td>)}</tr>
                  <tr><th scope="row">Forecast error now, +{horizon} h, µg/m³</th>{REGIONS.map((r) => <td key={r}><Val v={live(r)} d={2} /></td>)}</tr>
                  <tr><th scope="row">Test-period MAE, +{horizon} h, µg/m³</th>{REGIONS.map((r) => <td key={r}>{RES[r].test.plume?.mae[horizon - 1].toFixed(2) ?? '–'}</td>)}</tr>
                  <tr><th scope="row">Graph edges</th>{REGIONS.map((r) => <td key={r}>{ds[r].edges.length.toLocaleString('en-GB')}</td>)}</tr>
                </>)
              })()}
            </tbody>
          </table>
        </Panel>
        <Panel id="alerts" title="Alerts" aside={`${al.length} forecast crossings`}>
          <ol className="alerts">
            {al.length === 0 && <li className="empty">No station is forecast to cross a band edge in the next 24 h.</li>}
            {al.slice(0, 40).map((a) => (
              <li key={`${a.region}${a.station}`}>
                <button type="button" className="rowbtn" onClick={() => setState({ sel: { region: a.region, station: a.station } })}>
                  <span className="a-when num">+{a.lead} h<small>{utc(hourToDate(ds.europe, a.at), false)}</small></span>
                  <span className="a-what"><strong>{a.city}</strong> <span className="iso">{a.iso}</span><small>{a.name}</small></span>
                  <span className="a-th num"><span style={{ color: bandVar(a.now) }}>{fmt(a.now)}</span> → <span style={{ color: bandVar(a.threshold) }}>≥{a.threshold}</span>{a.threshold === 15 && <small>WHO</small>}</span>
                  <span className={`a-conf ${a.conf}`}>{a.conf === 'likely' ? 'likely' : 'possible'}<small>{a.conf === 'likely' ? 'P10 crosses' : 'P50 only'}</small></span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel id="globe" title="Map" aside="follows selection">
          <div className="mini"><MiniGlobe ds={ds} /></div>
        </Panel>
      </div>
      <footer className="term-foot">
        <Timeline compact />
        <CommandBar rows={rowsAll} pins={pins} setPins={setPins} />
      </footer>
    </main>
  )
}
