import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { loadAll } from './lib/data'
import { type DataSet, clockRange } from './lib/derive'
import { getState, setState } from './lib/store'
import { GlobeView } from './views/GlobeView'
import { type Intro, IntroCtx, Loader } from './ui/Loader'

const loadTerminal = () => import('./views/TerminalView')
const loadMethods = () => import('./views/MethodsView')
const TerminalView = lazy(loadTerminal)
const MethodsView = lazy(loadMethods)

/** Resolves once the page draws frames steadily (8 in a row under 25 ms), or after `cap` ms. The globe's first
 * frames compile shaders and build buffers; the wordmark should not start moving while that blocks the page. */
// first visit in this browser gets the travelling wordmark; later visits a shorter entrance
const SEEN = 'plume:seen'
const seenBefore = () => { try { return localStorage.getItem(SEEN) != null } catch { return false } }
const markSeen = () => { try { localStorage.setItem(SEEN, '1') } catch { /* private mode: every visit is a first */ } }

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
  const [entered, setEntered] = useState(false)
  const [first] = useState(() => !seenBefore())
  const booting = !(barFull && warm)
  const intro: Intro = booting ? 'boot' : entered ? 'done' : first ? 'fly' : 'letters'
  useEffect(() => {
    loadTerminal(); loadMethods()   // fetch the other views' code meanwhile, so any route has its header ready
    loadAll(setProgress).then(setDs).catch((e) => setErr(String(e.message ?? e)))
  }, [])
  // the view is mounted, hidden, as soon as the data is in; wait for it to settle before handing over
  useEffect(() => { if (ds) whenSmooth().then(() => setWarm(true)) }, [ds])
  // entrance: the rest of the view fades in while the wordmark arrives. A layout effect, so the attribute is
  // set before the revealed view is first painted.
  useLayoutEffect(() => {
    if (booting) return
    markSeen()
    document.documentElement.dataset.enter = ''
    const t = setTimeout(() => { delete document.documentElement.dataset.enter; setEntered(true) }, 1600)
    return () => clearTimeout(t)
  }, [booting])
  useClock(ds)
  return (
    <MotionConfig reducedMotion="user">
      <IntroCtx.Provider value={intro}>
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
        <AnimatePresence>
          {booting && (
            // the bar stops short of the end until the view has settled, so it never sits full while nothing happens
            <Loader key="loader" progress={warm ? 1 : Math.min(progress, 0.96)} error={err} word={first} onDone={() => setBarFull(true)} />
          )}
        </AnimatePresence>
      </IntroCtx.Provider>
    </MotionConfig>
  )
}
