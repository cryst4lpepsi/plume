import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

/** Persistent lens switch. State lives in the store, so station, region and time carry across. */
export function LensNav() {
  return (
    <nav className="lens" aria-label="Views">
      <NavLink to="/" end>Globe</NavLink>
      <NavLink to="/terminal">Terminal</NavLink>
      <NavLink to="/methods">Methods</NavLink>
    </nav>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); (e.currentTarget.nextElementSibling as HTMLElement ?? e.currentTarget.parentElement!.firstElementChild as HTMLElement).focus() }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); (e.currentTarget.previousElementSibling as HTMLElement ?? e.currentTarget.parentElement!.lastElementChild as HTMLElement).focus() }
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Icons: authored, one stroke weight, 16 px grid.
const I = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">{children}</svg>
)
export const IconPlay = () => <I><path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" /></I>
export const IconPause = () => <I><path d="M5 3.5v9M11 3.5v9" strokeWidth="2" /></I>
export const IconClose = () => <I><path d="M4 4l8 8M12 4l-8 8" /></I>
export const IconSearch = () => <I><circle cx="7" cy="7" r="4" /><path d="M10.2 10.2L13.5 13.5" /></I>
export const IconUp = () => <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M4.5 1L8.5 8H0.5z" fill="currentColor" /></svg>
export const IconDown = () => <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M4.5 8L8.5 1H0.5z" fill="currentColor" /></svg>

/** Signed change with an arrow; colour is never the only signal. */
export function Delta({ v, digits = 1, unit }: { v: number; digits?: number; unit?: string }) {
  if (!Number.isFinite(v)) return <span className="delta flat">–</span>
  const flat = Math.abs(v) < 0.05
  return (
    <span className={`delta ${flat ? 'flat' : v > 0 ? 'rise' : 'fall'}`}>
      {flat ? <span aria-hidden="true">·</span> : v > 0 ? <IconUp /> : <IconDown />}
      <span>{v > 0 ? '+' : v < 0 ? '−' : ''}{Math.abs(v).toFixed(digits)}{unit}</span>
    </span>
  )
}

export const utc = (d: Date, withDate = true) => {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  if (!withDate) return `${hh}:00`
  return `${d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${hh}:00 UTC`
}
