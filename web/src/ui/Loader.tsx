// Boot screen and the wordmark's entrance. On a first visit the loader shows the wordmark over a thin
// progress bar, and the word then travels to the header of the view that opens (shared layoutId). Later
// visits have no loader; the header's word builds in letter by letter.
import { createContext, useContext, useEffect, useRef } from 'react'
import { motion, useMotionValueEvent, useSpring } from 'framer-motion'

const WORD_ID = 'plume-word'
const FLY = { type: 'spring', stiffness: 140, damping: 24, mass: 1 } as const
const EASE = [0.16, 1, 0.3, 1] as const
const LETTER = {
  hidden: { opacity: 0, y: '0.35em', filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
}

/** boot: loader up, headers hold a hidden placeholder. fly / letters: the entrance in progress. done: static. */
export type Intro = 'boot' | 'fly' | 'letters' | 'done'
export const IntroCtx = createContext<Intro>('done')

/** "Plume" in a page header. Animates only during the entrance; page switches afterwards leave it still. */
export function Wordmark() {
  const intro = useContext(IntroCtx)
  if (intro === 'boot') return <span className="plume-word" style={{ visibility: 'hidden' }}>Plume</span>
  if (intro === 'fly') return <motion.span layoutId={WORD_ID} className="plume-word" transition={FLY}>Plume</motion.span>
  if (intro === 'letters') return (
    <motion.span className="plume-word" aria-label="Plume" initial="hidden" animate="shown" transition={{ staggerChildren: 0.06, delayChildren: 0.15 }}>
      {[...'Plume'].map((c, i) => <motion.span key={i} aria-hidden variants={LETTER}>{c}</motion.span>)}
    </motion.span>
  )
  return <span className="plume-word">Plume</span>
}

/** progress 0..1; onDone runs once the bar has visibly reached the end. */
export function Loader({ progress, error, onDone }: { progress: number; error: string | null; onDone: () => void }) {
  const bar = useSpring(0, { stiffness: 70, damping: 20, restDelta: 0.001 })
  const fired = useRef(false), track = useRef<HTMLDivElement>(null)
  useEffect(() => { bar.set(progress) }, [bar, progress])
  useMotionValueEvent(bar, 'animationComplete', () => {
    if (progress >= 1 && bar.get() > 0.999 && !fired.current) { fired.current = true; setTimeout(onDone, 180) }
  })
  useMotionValueEvent(bar, 'change', (v) => track.current?.setAttribute('aria-valuenow', String(Math.round(v * 100))))
  return (
    <main className="loader" aria-busy={!error}>
      <motion.div className="loader-inner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <h1><motion.span layoutId={WORD_ID} className="plume-word" transition={FLY}>Plume</motion.span></h1>
        {error ? <p role="alert" className="loader-err">{error}</p> : (
          <div ref={track} className="loader-bar" role="progressbar" aria-label="Loading the replay" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
            <motion.span style={{ scaleX: bar }} />
          </div>
        )}
      </motion.div>
    </main>
  )
}
