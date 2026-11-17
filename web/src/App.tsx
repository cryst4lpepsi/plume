import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { loadAll } from './lib/data'
import { type DataSet, clockRange } from './lib/derive'
import { getState, setState } from './lib/store'
import { GlobeView } from './views/GlobeView'
import { BootCtx, Loader } from './ui/Loader'

const loadTerminal = () => import('./views/TerminalView')
const loadMethods = () => import('./views/MethodsView')
const TerminalView = lazy(loadTerminal)
const MethodsView = lazy(loadMethods)

/** Resolves once the page draws frames steadily (8 in a row under 25 ms), or after `cap` ms. The globe's first
 * frames compile shaders and build buffers; the wordmark should not start moving while that blocks the page. */
function whenSmooth(cap = 2500): Promise<void> {
  return new Promise((res) => {
    const t0 = performance.now(); let last = t0, run = 0
    const tick = (t: number) => {
      run = t - last < 25 ? run + 1 : 0; last = t
      if (run >= 8 || t - t0 > cap) res(); else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

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
  const [progress, setProgress] = useState(0)
  const [barFull, setBarFull] = useState(false)
  const [warm, setWarm] = useState(false)
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    loadTerminal(); loadMethods()   // fetch the other views' code meanwhile, so any route has its header ready
    loadAll(setProgress).then(setDs).catch((e) => setErr(String(e.message ?? e)))
  }, [])
  // the view is mounted, hidden, as soon as the data is in; wait for it to settle before handing over
  useEffect(() => { if (ds) whenSmooth().then(() => setWarm(true)) }, [ds])
  useEffect(() => {
    if (!barFull || !warm) return
    // first entrance only: the rest of the view fades in while the wordmark travels to the header
    document.documentElement.dataset.enter = ''
    const t = setTimeout(() => delete document.documentElement.dataset.enter, 1600)
    setBooting(false)
    return () => clearTimeout(t)
  }, [barFull, warm])
  useClock(ds)
  return (
    <MotionConfig reducedMotion="user">
      <BootCtx.Provider value={booting}>
        {ds && (
          <div className={booting ? 'app app-booting' : 'app'} aria-hidden={booting || undefined}>
            <DataCtx.Provider value={ds}>
              <Suspense fallback={<main className="boot"><h1>Plume</h1><p>Loading view.</p></main>}>
                <Routes>
                  <Route path="/" element={<GlobeView />} />
                  <Route path="/terminal" element={<TerminalView />} />
                  <Route path="/methods" element={<MethodsView />} />
                </Routes>
              </Suspense>
            </DataCtx.Provider>
          </div>
        )}
        {booting && (
          // the bar stops short of the end until the view has settled, so it never sits full while nothing happens
          <Loader progress={warm ? 1 : Math.min(progress, 0.96)} error={err} onDone={() => setBarFull(true)} />
        )}
      </BootCtx.Provider>
    </MotionConfig>
  )
}
