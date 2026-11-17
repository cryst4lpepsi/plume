// Boot screen: the wordmark over a thin progress bar. When the data is in, the wordmark is handed to the
// header of the view that opens (shared layoutId), so it travels there instead of disappearing.
import { createContext, useContext, useEffect, useRef } from 'react'
import { motion, useMotionValueEvent, useSpring, useTransform } from 'framer-motion'

const WORD_ID = 'plume-word'
const FLY = { type: 'spring', stiffness: 140, damping: 24, mass: 1 } as const

/** True while the boot screen is up. Headers keep their wordmark as a hidden placeholder until then. */
export const BootCtx = createContext(false)

/** "Plume" as a shared element. Every header that shows the name renders this, so it can receive the loader's word.
 * During boot a header holds only a hidden placeholder; when boot ends it mounts the shared element, which then
 * travels from where the loader's word was. */
export function Wordmark({ source = false }: { source?: boolean }) {
  const booting = useContext(BootCtx)
  if (booting && !source) return <span className="plume-word" style={{ visibility: 'hidden' }}>Plume</span>
  return <motion.span layoutId={WORD_ID} className="plume-word" transition={FLY}>Plume</motion.span>
}

/** progress 0..1; onDone runs once the bar has visibly reached the end. */
export function Loader({ progress, error, onDone }: { progress: number; error: string | null; onDone: () => void }) {
  const bar = useSpring(0, { stiffness: 70, damping: 20, restDelta: 0.001 })
  const pct = useTransform(bar, (v) => Math.round(v * 100))
  const fired = useRef(false)
  useEffect(() => { bar.set(progress) }, [bar, progress])
  useMotionValueEvent(bar, 'animationComplete', () => {
    if (progress >= 1 && bar.get() > 0.999 && !fired.current) { fired.current = true; setTimeout(onDone, 180) }
  })
  useMotionValueEvent(pct, 'change', (v) => { const el = document.getElementById('loader-bar'); el?.setAttribute('aria-valuenow', String(v)) })
  return (
    <main className="loader" aria-busy={!error}>
      <motion.div className="loader-inner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
        <h1><Wordmark source /></h1>
        {error ? <p role="alert" className="loader-err">{error}</p> : (
          <div id="loader-bar" className="loader-bar" role="progressbar" aria-label="Loading the replay" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
            <motion.span style={{ scaleX: bar }} />
          </div>
        )}
      </motion.div>
    </main>
  )
}
