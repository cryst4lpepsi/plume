import { useMemo, useRef, useState } from 'react'
import { useData } from '../App'
import { REGIONS, lastObs, type RegionKey } from '../lib/data'
import { setState, useHour } from '../lib/store'
import { fmt } from '../lib/pm'
import { IconSearch } from './bits'

export interface Hit { region: RegionKey; station: number; label: string; sub: string }
export function useStationIndex() {
  const ds = useData()
  return useMemo(() => {
    const all: Hit[] = []
    for (const r of REGIONS) ds[r].stations.forEach((s, i) => all.push({ region: r, station: i, label: s.name, sub: `${s.city}, ${s.country}` }))
    return all
  }, [ds])
}
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export function searchStations(all: Hit[], q: string, limit = 8): Hit[] {
  const n = norm(q.trim())
  if (!n) return []
  const scored: [number, Hit][] = []
  for (const h of all) {
    const a = norm(h.label), b = norm(h.sub)
    const sc = a.startsWith(n) ? 0 : b.startsWith(n) ? 1 : a.includes(n) ? 2 : b.includes(n) ? 3 : -1
    if (sc >= 0) scored.push([sc, h])
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].label.localeCompare(y[1].label)).slice(0, limit).map((x) => x[1])
}

/** Searchable station list: the globe's text alternative. */
export function StationSearch() {
  const ds = useData()
  const all = useStationIndex()
  const hour = useHour()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const hits = useMemo(() => (q ? searchStations(all, q, 30) : all.slice(0, 0)), [all, q])
  const input = useRef<HTMLInputElement>(null)
  const pick = (h: Hit) => { setState({ sel: { region: h.region, station: h.station } }); setOpen(false); setQ(''); input.current?.blur() }
  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <label className="search-field">
        <IconSearch />
        <span className="sr-only">Find a station or city</span>
        <input ref={input} type="text" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="station-list" aria-autocomplete="list"
          placeholder="Find a station or city" value={q} autoComplete="off" spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            if (e.key === 'Enter' && hits[active]) pick(hits[active])
            if (e.key === 'Escape') { setOpen(false); setQ('') }
          }} />
      </label>
      {open && q && (
        <ul id="station-list" className="search-list" role="listbox" aria-label="Stations">
          {hits.length === 0 && <li className="search-empty">No station or city matches “{q}”. Names are Latin script, for example Delhi, Seoul, Warsaw.</li>}
          {hits.map((h, i) => (
            <li key={`${h.region}${h.station}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(h) }}>
              <span className="search-name">{h.label}</span>
              <span className="search-sub">{h.sub}</span>
              <span className="num">{fmt(lastObs(ds[h.region], hour, h.station))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
