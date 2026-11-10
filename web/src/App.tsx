import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { loadRegion } from './lib/data'
import { type DataSet, clockRange } from './lib/derive'
import { getState, setState } from './lib/store'
import { GlobeView } from './views/GlobeView'

const TerminalView = lazy(() => import('./views/TerminalView'))
const MethodsView = lazy(() => import('./views/MethodsView'))

const DataCtx = createContext<DataSet | null>(null)
export const useData = () => useContext(DataCtx)!

/** Advances the replay clock. One clock for every view, so panels and the globe move together. */
function useClock(ds: DataSet | null) {
  useEffect(() => {
    if (!ds) return
    const { min, max } = clockRange(ds)
    if (getState().hour < min) {
      // start a third of the way in so there is history behind "now"
      setState({ hour: min + Math.round((max - min) * 0.3), playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches })
    }
    let raf = 0, last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t
      const s = getState()
      if (s.playing) {
        let h = s.hour + dt * s.speed
        if (h >= max) h = min
        setState({ hour: h })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ds])
}

export default function App() {
  const [ds, setDs] = useState<DataSet | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([loadRegion('europe'), loadRegion('asia')])
      .then(([europe, asia]) => setDs({ europe, asia }))
      .catch((e) => setErr(String(e.message ?? e)))
  }, [])
  useClock(ds)
  if (err) return <main className="boot"><h1>Plume</h1><p role="alert">{err}</p></main>
  if (!ds) return <main className="boot"><h1>Plume</h1><p aria-live="polite">Loading the replay: observations, forecasts and baselines for about 840 stations.</p></main>
  return (
    <DataCtx.Provider value={ds}>
      <Suspense fallback={<main className="boot"><h1>Plume</h1><p>Loading view.</p></main>}>
        <Routes>
          <Route path="/" element={<GlobeView />} />
          <Route path="/terminal" element={<TerminalView />} />
          <Route path="/methods" element={<MethodsView />} />
        </Routes>
      </Suspense>
    </DataCtx.Provider>
  )
}
