// Test-period scores for each region view. Europe and Asia come from results/main.json; India is the
// Indian stations of the Asia model, scored on their own (results/slices.json). Winter figures are the
// separate winter test (results/winter.json, slices.json for India).
import mainResults from '@results/main.json'
import slices from '@results/slices.json'
import winter from '@results/winter.json'
import type { RegionView } from './store'

export type Scores = Record<string, { mae: number[]; rmse: number[]; skill: number[]; mae_sd?: number[] }>
export type ScoreKey = 'europe' | 'asia' | 'india'

const MAIN = mainResults as unknown as Record<'europe' | 'asia', { test: Scores }> & { commit: string }
const INDIA = (slices as unknown as { asia: { india: { stations: number; test: Scores; winter: Scores } } }).asia.india
const WINTER = winter as unknown as Record<'europe' | 'asia', Scores | null>

export const COMMIT = MAIN.commit
export const INDIA_STATIONS = INDIA.stations
export const SCORE_NAME: Record<ScoreKey, string> = { europe: 'Europe', asia: 'Asia', india: 'India' }

export const testScores = (k: ScoreKey): Scores => (k === 'india' ? INDIA.test : MAIN[k].test)
export const winterScores = (k: ScoreKey): Scores | null => (k === 'india' ? INDIA.winter : WINTER[k])

/** The score sets a region view reports: one per region, or both regions for 'both'. */
export const scoreKeys = (view: RegionView): ScoreKey[] => (view === 'both' ? ['europe', 'asia'] : [view])
