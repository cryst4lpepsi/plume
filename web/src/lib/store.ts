// One small external store shared by the Globe and the Terminal, so switching lens keeps
// the selected station, region, mode, horizon and clock.
import { useSyncExternalStore } from 'react'
import type { RegionKey } from './data'

export type Mode = 'observed' | 'forecast' | 'error' | 'influence'
export type RegionView = RegionKey | 'both' | 'india'   // india: the Indian stations of the Asian graph
export interface Sel { region: RegionKey; station: number }
export interface State {
  hour: number          // replay clock, fractional hours on the data time axis
  playing: boolean
  speed: number         // replay hours per real second
  mode: Mode
  region: RegionView
  horizon: number       // 1..24
  sel: Sel | null
  lowPower: boolean
  lowPowerAuto: boolean // true once the frame-time watchdog has switched it on
  baselines: { persistence: boolean; seasonal: boolean; lightgbm: boolean; cams: boolean }
}

// ?qa=<steps> lets headless screenshot runs (software WebGL) cap the atmosphere ray-march; it has no UI.
export const QA = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('qa') : null
let state: State = {
  hour: 0, playing: true, speed: 2, mode: 'observed', region: 'both', horizon: 12, sel: null,
  lowPower: false, lowPowerAuto: false,
  baselines: { persistence: false, seasonal: false, lightgbm: false, cams: true },
}
const subs = new Set<() => void>()
export const getState = () => state
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f))
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}
/** Whole-hour clock; components that only care about hourly data subscribe to this to avoid 60 fps renders. */
export const useHour = () => useStore((s) => Math.floor(s.hour))
// QA hook for scripted screenshots and command-bar tests; inert without ?qa.
if (QA && typeof window !== 'undefined') (window as unknown as { __plume: unknown }).__plume = { getState, setState }
