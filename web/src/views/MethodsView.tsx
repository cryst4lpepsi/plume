import { Link } from 'react-router-dom'
import { LensNav } from '../ui/bits'
import { Wordmark } from '../ui/Loader'
import { HorizonChart, type Series } from '../charts/HorizonChart'
import main from '@results/main.json'
import ablation from '@results/ablation.json'
import calibration from '@results/calibration.json'
import unseen from '@results/unseen.json'
import quality from '@results/data_quality.json'
import graph from '@results/graph.json'
import winter from '@results/winter.json'

/* Every number on this page is read from results/*.json. Prose that depends on a result is chosen
   by comparing those numbers, so the text cannot drift from the files. */
type M = { mae: number[]; rmse: number[]; skill: number[]; mae_sd?: number[]; rmse_sd?: number[]; seeds?: number; mae_all: number; mae_all_sd?: number; mae_per_seed?: number[] }
type RegionRes = { chosen: string; val_mae_candidates: Record<string, number>; n_eval_test: number; test: Record<string, M>; val: Record<string, M> }
const R = main as unknown as { commit: string; europe: RegionRes; asia: RegionRes }
const AB = ablation as unknown as Record<'europe' | 'asia', { test: Record<'none' | 'dist' | 'wind', M | null> }>
const CAL = calibration as unknown as Record<'europe' | 'asia', { coverage_p10_p90: { mean: number[]; sd: number[] }; share_below_p10: { mean: number[] }; share_below_p90: { mean: number[] }; mean_band_width: { mean: number[] } } | undefined>
const UN = unseen as unknown as Record<'europe' | 'asia', { held_out: number; held_out_with_neighbour_in_range: number; coverage_p10_p90: number[]; graph_model_masked: M; idw_of_neighbour_last_obs: M; idw_of_neighbour_forecasts?: M } | undefined>
const Q = quality as unknown as Record<'europe' | 'asia', Record<string, any>>
const G = graph as unknown as Record<'europe' | 'asia', Record<string, number>>
const W = winter as unknown as Record<'europe' | 'asia', Record<string, M> | null>
const REG = ['europe', 'asia'] as const
const NAME = { europe: 'Europe', asia: 'Asia' }
const HS = [1, 3, 6, 12, 24]
const MODELS: [string, string][] = [['plume', 'Plume graph model'], ['lightgbm', 'LightGBM, same features, no graph'], ['persistence', 'Persistence'], ['seasonal_naive', 'Seasonal naive (same hour yesterday)'], ['cams', 'CAMS via Open-Meteo']]
const n0 = (v: number) => v.toLocaleString('en-GB')
// cleaning counts are missing for a run that restored its data stage from a checkpoint (see data_quality.json)
const nr = (v: number | undefined) => (v == null ? 'not recorded' : n0(v))
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

function ResultsTable({ r, metric }: { r: 'europe' | 'asia'; metric: 'mae' | 'rmse' }) {
  const t = R[r].test
  return (
    <div className="table-wrap">
      <table className="mt">
        <caption><span>{NAME[r]}, test period (Aug to Oct 2026): {metric === 'mae' ? 'mean absolute error' : 'root mean squared error'} in µg/m³ by forecast horizon. Lowest value in each column is marked.</span></caption>
        <thead><tr><th scope="col">Model</th>{HS.map((h) => <th key={h} scope="col">{h} h</th>)}{metric === 'mae' && <th scope="col">Skill at 24 h</th>}</tr></thead>
        <tbody>
          {MODELS.map(([k, name]) => t[k] && (
            <tr key={k} className={k === 'plume' ? 'ours' : ''}>
              <th scope="row">{name}</th>
              {HS.map((h) => {
                const best = Math.min(...MODELS.map(([j]) => t[j]?.[metric][h - 1] ?? Infinity))
                const sd = (metric === 'mae' ? t[k].mae_sd : t[k].rmse_sd)?.[h - 1]
                return <td key={h} className={t[k][metric][h - 1] === best ? 'best' : ''}>{t[k][metric][h - 1].toFixed(2)}{sd != null && <small> ±{sd.toFixed(2)}</small>}</td>
              })}
              {metric === 'mae' && <td>{k === 'persistence' ? 'reference' : `${t[k].skill[23] >= 0 ? '+' : '−'}${Math.abs(t[k].skill[23] * 100).toFixed(1)}%`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Headline({ r }: { r: 'europe' | 'asia' }) {
  const t = R[r].test, p = t.plume
  if (!p) return null
  const losses = HS.filter((h) => MODELS.some(([k]) => k !== 'plume' && t[k] && t[k].mae[h - 1] < p.mae[h - 1]))
  const beatsLgb = HS.filter((h) => t.lightgbm && p.mae[h - 1] < t.lightgbm.mae[h - 1])
  const who = (h: number) => MODELS.filter(([k]) => k !== 'plume' && t[k] && t[k].mae[h - 1] < p.mae[h - 1]).map(([, n]) => n.split(',')[0].split(' (')[0]).join(' and ')
  return (
    <p>
      In {NAME[r]} the graph model's MAE runs from {p.mae[0].toFixed(2)} µg/m³ at 1 h to {p.mae[23].toFixed(2)} µg/m³ at 24 h, a skill of {pct(p.skill[0], 1)} and {pct(p.skill[23], 1)} against persistence.{' '}
      {losses.length === 0 ? 'It has the lowest MAE of the five models at every reported horizon.' : <>It does <strong>not</strong> have the lowest MAE at {losses.map((h) => `${h} h (${who(h)} ${who(h).includes(' and ') ? 'are' : 'is'} lower)`).join(', ')}.</>}{' '}
      {t.lightgbm && (beatsLgb.length === HS.length ? 'It beats the graph-free LightGBM at every reported horizon, which is the fairest test of whether the graph adds anything.'
        : beatsLgb.length === 0 ? 'The graph-free LightGBM is as good or better at every reported horizon, so on this evidence the graph adds nothing over a well-fed tabular model here.'
        : `Against the graph-free LightGBM it is ahead at ${beatsLgb.join(', ')} h and behind at the other reported horizons.`)}
    </p>
  )
}

function AblationText() {
  const d = (r: 'europe' | 'asia', k: 'dist' | 'wind') => { const a = AB[r].test; return a.none && a[k] ? { diff: a[k]!.mae_all - a.none.mae_all, rel: a[k]!.mae_all / a.none.mae_all - 1, sd: Math.hypot(a[k]!.mae_all_sd ?? 0, a.none.mae_all_sd ?? 0), seeds: Math.min(a[k]!.seeds ?? 1, a.none.seeds ?? 1) } : null }
  const w = (r: 'europe' | 'asia') => { const a = AB[r].test; return a.dist && a.wind ? { diff: a.wind.mae_all - a.dist.mae_all, rel: a.wind.mae_all / a.dist.mae_all - 1, sd: Math.hypot(a.wind.mae_all_sd ?? 0, a.dist.mae_all_sd ?? 0) } : null }
  const say = (x: { diff: number; rel: number; sd: number } | null, what: string) => !x ? 'not available'
    : Math.abs(x.diff) <= x.sd ? `${what} changes mean MAE by ${x.diff >= 0 ? '+' : '−'}${Math.abs(x.diff).toFixed(3)} µg/m³ (${x.rel >= 0 ? '+' : '−'}${pct(Math.abs(x.rel), 1)}), inside the seed-to-seed spread of ±${x.sd.toFixed(3)}`
    : `${what} ${x.diff < 0 ? 'lowers' : 'raises'} mean MAE by ${Math.abs(x.diff).toFixed(3)} µg/m³ (${pct(Math.abs(x.rel), 1)}), more than the seed-to-seed spread of ±${x.sd.toFixed(3)}`
  const seeds = d('europe', 'wind')?.seeds
  return (
    <>
      <p><strong>Europe (dense, median edge {G.europe.median_edge_km.toFixed(0)} km).</strong> {say(d('europe', 'dist'), 'Adding a distance-only graph to the no-graph model')}. {say(w('europe'), 'Making the edges wind-aware on top of that')}.</p>
      <p><strong>Asia (sparse, median edge {G.asia.median_edge_km.toFixed(0)} km, up to 500 km).</strong> {say(d('asia', 'dist'), 'Adding a distance-only graph to the no-graph model')}. {say(w('asia'), 'Making the edges wind-aware on top of that')}.</p>
      <p className="note">Mean over all 24 horizons and {seeds ?? '–'} seed{seeds === 1 ? '' : 's'} per variant. "Seed-to-seed spread" is the two standard deviations combined in quadrature; with three seeds it is a rough guide, not a significance test.</p>
    </>
  )
}

export default function MethodsView() {
  const abSeries = (r: 'europe' | 'asia'): Series[] => {
    const a = AB[r].test
    if (!a.none) return []
    const rel = (m: M | null) => (m ? m.mae.map((v, i) => (v / a.none!.mae[i] - 1) * 100) : [])
    const sd = (m: M | null) => (m?.mae_sd ? m.mae_sd.map((v, i) => (v / a.none!.mae[i]) * 100) : undefined)
    return [
      ...(a.dist ? [{ name: 'Distance-only edges', values: rel(a.dist), sd: sd(a.dist), cls: 's-dist', dash: '5 3' }] : []),
      ...(a.wind ? [{ name: 'Wind-aware edges', values: rel(a.wind), sd: sd(a.wind), cls: 's-wind' }] : []),
    ]
  }
  return (
    <div className="methods">
      <header className="m-top"><Link to="/" className="m-mark"><Wordmark /></Link><LensNav /></header>
      <article>
        <header className="m-head">
          <h1>How Plume works, and how well</h1>
          <p className="standfirst">A small graph network forecasts PM2.5 a day ahead at {G.europe.stations + G.asia.stations} monitoring stations. This page says what it was trained on, what it was compared with, and where it loses.</p>
          <p className="m-meta">Every figure below is read from <code>results/*.json</code>, written by scripts in the repository at commit <code>{R.commit}</code>. <code>make eval</code> regenerates them.</p>
        </header>

        <section>
          <h2>The problem</h2>
          <p>Fine particles (PM2.5) move. A plume that leaves one city arrives at the next some hours later, if the wind carries it there. A forecast for one monitoring station should therefore be able to use what its upwind neighbours measured. Plume treats stations as nodes in a graph, connects neighbours, and lets a network decide, hour by hour, how much each neighbour matters.</p>
          <p>The task: given the last 48 hours at every station, forecast hourly PM2.5 for each of the next 24 hours, as three quantiles (P10, P50, P90). Europe and Asia are separate graphs with no edges between them, and are scored separately.</p>
        </section>

        <section>
          <h2>Data</h2>
          <p>European observations come mainly from the European Environment Agency, whose national networks also say whether a station is background, traffic or industrial. The rest, and all of Asia, come from the OpenAQ archive on AWS Open Data, which redistributes measurements from many national and local providers under their own licences. Satellite fire detections (NASA FIRMS) are an input: the fire power within 100 and 300 km of each station over the previous day. The period is the 24 complete months to October 2026, split by time: 18 months to train, 3 to validate (May to July 2026), 3 to test (August to October 2026). Nothing is shuffled across time.</p>
          <div className="table-wrap">
            <table className="mt">
              <caption><span>Station selection and cleaning, per region.</span></caption>
              <thead><tr><th scope="col"><span className="sr-only">Measure</span></th><th scope="col">Europe</th><th scope="col">Asia</th></tr></thead>
              <tbody>
                <tr><th scope="row">Candidate stations downloaded</th>{REG.map((r) => <td key={r}>{nr(Q[r].candidates_downloaded)}</td>)}</tr>
                <tr><th scope="row">Coverage threshold (share of hours)</th>{REG.map((r) => <td key={r}>{pct(Q[r].coverage_threshold)}</td>)}</tr>
                <tr><th scope="row">Candidates passing</th>{REG.map((r) => <td key={r}>{nr(Q[r].candidates_ge_threshold)}</td>)}</tr>
                <tr><th scope="row">Stations used</th>{REG.map((r) => <td key={r}>{n0(Q[r].stations)}</td>)}</tr>
                <tr><th scope="row">Countries</th>{REG.map((r) => <td key={r}>{Object.keys(Q[r].per_country).length}</td>)}</tr>
                <tr><th scope="row">Median station coverage</th>{REG.map((r) => <td key={r}>{pct(Q[r].median_station_coverage, 1)}</td>)}</tr>
                <tr><th scope="row">Negative readings dropped</th>{REG.map((r) => <td key={r}>{nr(Q[r].dropped_negative_rows)}</td>)}</tr>
                <tr><th scope="row">Readings above 2,000 µg/m³ dropped</th>{REG.map((r) => <td key={r}>{nr(Q[r].dropped_over_2000_rows)}</td>)}</tr>
                <tr><th scope="row">Flat-lined hours removed (12 h or more)</th>{REG.map((r) => <td key={r}>{nr(Q[r].removed_flatline_hours)}</td>)}</tr>
                <tr><th scope="row">Single-hour spikes removed</th>{REG.map((r) => <td key={r}>{nr(Q[r].removed_spike_hours)}</td>)}</tr>
                <tr><th scope="row">Hours filled by interpolation (gaps of 3 h or less)</th>{REG.map((r) => <td key={r}>{pct(Q[r].interpolated_short_gap_hours / Q[r].station_hours, 1)}</td>)}</tr>
                <tr><th scope="row">Hours left missing and masked in the loss</th>{REG.map((r) => <td key={r}>{pct(Q[r].missing_hours / Q[r].station_hours, 1)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {REG.map((r) => (
            <p key={r} className="countries"><strong>{NAME[r]} by country:</strong> {Object.entries(Q[r].per_country as Record<string, number>).map(([c, n]) => `${c} ${n}`).join(', ')}.</p>
          ))}
          <p>Asia's coverage is uneven. Japan and Korea have over a thousand and six hundred well-kept stations; India's feed is missing from the archive for November 2024 to February 2025, which caps Indian stations near 83% before any ordinary gap. The Asian threshold was therefore lowered to 70% so that India and Thailand are in the graph at all, and each country's share is limited so the two largest networks do not swamp it. China is nearly absent from the archive. "Asia" here means East, South-East and South Asia as OpenAQ happens to cover them.</p>
          <p>Weather (10 m wind, temperature, humidity, precipitation, boundary-layer height) is ERA5 reanalysis at the grid cell nearest each station. The main model only ever sees past weather.</p>
        </section>

        <section>
          <h2>The graph</h2>
          <p>Each station receives edges from its {G.europe.k} nearest neighbours within {G.europe.max_km.toFixed(0)} km in Europe and {G.asia.max_km.toFixed(0)} km in Asia. That gives {n0(G.europe.edges)} edges with a median length of {G.europe.median_edge_km.toFixed(0)} km in Europe, and {n0(G.asia.edges)} edges with a median of {G.asia.median_edge_km.toFixed(0)} km in Asia. {G.europe.isolated_self_loop_only} European and {G.asia.isolated_self_loop_only} Asian stations have no neighbour in range and are forecast from their own history alone.</p>
          <p>Every edge carries its length and bearing. At each forecast it also carries a wind feature: the wind at the source station projected onto the direction of the destination, now and averaged over the last 6 and 24 hours. A positive value means the source is upwind.</p>
        </section>

        <section>
          <h2>The model</h2>
          <p>A GRU reads each station's 48-hour window of PM2.5, weather and local calendar features. Two message-passing layers then let each station attend to its neighbours; a gate computed from the edge features, including the wind feature, scales each message. A small decoder outputs the median forecast for 24 horizons plus two positive offsets, so P10, P50 and P90 cannot cross. Training minimises pinball loss on hours that were really observed. The network has about 80 thousand parameters and trains on a laptop CPU in about half an hour.</p>
          <p>Two variants were trained: one model per region, and one model with shared weights on both graphs. Whichever had the lower validation MAE in a region is the one reported for that region: {REG.map((r) => `${NAME[r]} uses the ${R[r].chosen === 'plume_shared' ? 'shared' : 'per-region'} model (validation MAE ${Object.entries(R[r].val_mae_candidates).map(([k, v]) => `${k === 'plume_shared' ? 'shared' : 'per-region'} ${v.toFixed(3)}`).join(', ')})`).join('; ')}.</p>
        </section>

        <section>
          <h2>Results</h2>
          <p>All models are scored on the same set of forecasts: every hourly origin in the test period, every station that reported in the 48 hours before the origin, and every horizon whose target hour was really measured. The graph model was trained three times with different random seeds; its rows show the mean and standard deviation.</p>
          {REG.map((r) => (
            <div key={r} className="region-block">
              <h3>{NAME[r]}</h3>
              <Headline r={r} />
              <ResultsTable r={r} metric="mae" />
              <ResultsTable r={r} metric="rmse" />
              <figure className="wide">
                <HorizonChart label={`${NAME[r]}: skill against persistence by horizon for each model`} yLabel="Skill vs persistence" format={(v) => `${(v * 100).toFixed(0)}%`}
                  refLine={{ y: 0, label: 'Persistence' }} yDomain={[-0.6, 0.4]}
                  series={MODELS.filter(([k]) => k !== 'persistence' && R[r].test[k]).map(([k, n]) => ({ name: n.split(',')[0].split(' (')[0], values: R[r].test[k].skill, cls: `s-${k}`, dash: k === 'plume' ? undefined : k === 'lightgbm' ? '2 2' : k === 'cams' ? '8 3 1 3' : '5 3' }))} />
                <figcaption>{NAME[r]}: skill against persistence (1 − MAE ÷ persistence MAE). Above zero beats persistence. The axis stops at −60%; seasonal naive and CAMS fall further below it at short horizons because neither uses the latest measurement (the tables have the values). {n0(R[r].n_eval_test)} station-origin pairs at the 1 h horizon.</figcaption>
              </figure>
            </div>
          ))}
          <aside className="caveat">
            <h3>Read the CAMS row with care</h3>
            <p>The CAMS series stored by Open-Meteo is stitched from recent forecast runs, so each value was produced only a few hours ahead. It is a strong physical baseline, not a 24-hours-ahead forecast, and comparing it with a model at the 24 h horizon flatters it. The two regions also use different products: {`CAMS Europe on a 0.1° grid, and CAMS global on a 0.4° grid`} that Open-Meteo interpolates from 3-hourly to hourly. Skill against CAMS in Europe and in Asia is not like for like. CAMS is also a grid-cell average and is compared here with a point measurement, uncorrected.</p>
          </aside>
        </section>

        <section>
          <h2>Does the wind-aware graph help?</h2>
          <p>Three versions of the per-region model were trained, three seeds each: no message passing at all, edges that know only distance and bearing, and the full wind-aware edges. The chart shows MAE relative to the no-graph version, so anything below zero is the graph helping.</p>
          <div className="pair">
            {REG.map((r) => (
              <figure key={r}>
                <HorizonChart label={`${NAME[r]} ablation: change in MAE relative to the no-graph model by horizon`} yLabel="MAE vs no graph" height={240} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  refLine={{ y: 0, label: 'No graph' }} series={abSeries(r)} />
                <figcaption>{NAME[r]}. Shaded: ±1 standard deviation across seeds.</figcaption>
              </figure>
            ))}
          </div>
          <AblationText />
        </section>

        <section>
          <h2>Calibration</h2>
          <p>If the quantiles are honest, 80% of measurements should fall between P10 and P90 at every horizon.</p>
          <figure className="wide">
            <HorizonChart label="Share of test observations inside the P10 to P90 band by horizon, both regions" yLabel="Inside P10–P90" format={(v) => `${(v * 100).toFixed(0)}%`} yDomain={[0.6, 0.95]} refLine={{ y: 0.8, label: 'Target 80%' }}
              series={REG.filter((r) => CAL[r]).map((r) => ({ name: NAME[r], values: CAL[r]!.coverage_p10_p90.mean, sd: CAL[r]!.coverage_p10_p90.sd, cls: r === 'europe' ? 's-plume' : 's-asia' }))} />
            <figcaption>Coverage of the P10 to P90 band on the test period, mean of three seeds.</figcaption>
          </figure>
          {REG.map((r) => CAL[r] && (
            <p key={r}><strong>{NAME[r]}:</strong> coverage averages {pct(mean(CAL[r]!.coverage_p10_p90.mean), 1)} across horizons (from {pct(Math.min(...CAL[r]!.coverage_p10_p90.mean), 1)} to {pct(Math.max(...CAL[r]!.coverage_p10_p90.mean), 1)}). {pct(mean(CAL[r]!.share_below_p10.mean), 1)} of measurements fall below P10 and {pct(1 - mean(CAL[r]!.share_below_p90.mean), 1)} above P90; the band is on average {mean(CAL[r]!.mean_band_width.mean).toFixed(1)} µg/m³ wide.{' '}
              {Math.abs(mean(CAL[r]!.coverage_p10_p90.mean) - 0.8) < 0.02 ? 'That is close to the target.' : mean(CAL[r]!.coverage_p10_p90.mean) < 0.8 ? 'The band is too narrow: the model is overconfident on the test period.' : 'The band is wider than it needs to be.'}</p>
          ))}
        </section>

        {(UN.europe || UN.asia) && (
          <section>
            <h2>Stations the model has never seen</h2>
            <p>For this experiment 15% of stations were removed from training entirely. At test time their own history is masked and the model has to forecast them from neighbours alone. Two interpolation baselines use the same neighbours: an inverse-distance average of the neighbours' last measurements, and an inverse-distance average of the main model's forecasts for those neighbours.</p>
            <div className="table-wrap">
              <table className="mt">
                <caption><span>Held-out stations, test period: MAE in µg/m³.</span></caption>
                <thead><tr><th scope="col">Region and method</th>{HS.map((h) => <th key={h} scope="col">{h} h</th>)}</tr></thead>
                <tbody>
                  {REG.filter((r) => UN[r]).flatMap((r) => ([['graph_model_masked', 'graph model, own history masked'], ['idw_of_neighbour_last_obs', 'inverse-distance, last measurements'], ['idw_of_neighbour_forecasts', 'inverse-distance, neighbours’ forecasts']] as const).map(([k, n]) => {
                    const m = UN[r]![k]
                    if (!m) return null
                    const rowBest = (h: number) => Math.min(...(['graph_model_masked', 'idw_of_neighbour_last_obs', 'idw_of_neighbour_forecasts'] as const).map((j) => UN[r]![j]?.mae[h - 1] ?? Infinity))
                    return <tr key={r + k}><th scope="row">{NAME[r]}: {n}</th>{HS.map((h) => <td key={h} className={m.mae[h - 1] === rowBest(h) ? 'best' : ''}>{m.mae[h - 1].toFixed(2)}</td>)}</tr>
                  }))}
                </tbody>
              </table>
            </div>
            <p className="note">{REG.filter((r) => UN[r]).map((r) => `${NAME[r]}: ${UN[r]!.held_out} stations held out, ${UN[r]!.held_out_with_neighbour_in_range} with at least one neighbour in range; P10 to P90 coverage ${pct(mean(UN[r]!.coverage_p10_p90), 0)}.`).join(' ')} One seed. Errors are several times larger than for stations with their own history: a nearby monitor is a weak substitute for the monitor itself.</p>
          </section>
        )}

        {(W.europe || W.asia) && (
          <section>
            <h2>Winter</h2>
            <p>The main test has no winter, when PM2.5 is highest. A second set of models was trained on data to August 2025 only and tested on December 2025 to February 2026. {REG.filter((r) => W[r]?.plume && W[r]?.lightgbm).map((r) => { const p = W[r]!.plume.mae_all, l = W[r]!.lightgbm.mae_all; return `${NAME[r]}: the graph model's mean error is ${p.toFixed(2)} against ${l.toFixed(2)} for LightGBM (${p < l ? `${((1 - p / l) * 100).toFixed(1)}% lower` : `${((p / l - 1) * 100).toFixed(1)}% higher`}).` }).join(' ')}</p>
            {REG.filter((r) => W[r]).map((r) => (
              <div className="table-wrap" key={r}>
                <table className="mt">
                  <caption><span>{NAME[r]}, winter test (Dec 2025 to Feb 2026): mean absolute error in µg/m³ by forecast horizon. Lowest value in each column is marked.</span></caption>
                  <thead><tr><th scope="col">Model</th>{HS.map((h) => <th key={h} scope="col">{h} h</th>)}</tr></thead>
                  <tbody>
                    {MODELS.map(([k, name]) => W[r]![k] && (
                      <tr key={k} className={k === 'plume' ? 'ours' : ''}>
                        <th scope="row">{name}</th>
                        {HS.map((h) => {
                          const best = Math.min(...MODELS.map(([j]) => W[r]![j]?.mae[h - 1] ?? Infinity))
                          return <td key={h} className={W[r]![k].mae[h - 1] === best ? 'best' : ''}>{W[r]![k].mae[h - 1].toFixed(2)}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2>Limitations</h2>
          <ul className="prose-list">
            <li>The main test period is three months, August to October 2026, with no winter. The winter test above uses models trained on eight fewer months, so its errors are not comparable with the main table.</li>
            <li>The app is a replay of that test period. Nothing here is a live forecast.</li>
            <li>Outside the EEA stations, the station mix is whatever the OpenAQ archive offers: reference monitors and low-cost sensors side by side, with no field to tell them apart. China is nearly absent; India lost four months, including its first winter.</li>
            <li>Weather inputs are reanalysis, which is cleaner than the forecasts a live system would have. Only past weather is used, but a live system's "past" would be slightly worse.</li>
            <li>Station names in non-Latin scripts were romanised by machine and are rough, especially Thai names and Japanese street addresses.</li>
            <li>Edge weights shown in the Influence view are what the network attends to. They are not a measurement of where air came from.</li>
            <li>The colour bands are anchored on the WHO 2021 24-hour guideline of 15 µg/m³ but are applied to hourly values. They are bands, not a health index.</li>
          </ul>
        </section>

        <section>
          <h2>What did not work</h2>
          <ul className="prose-list">
            <li><strong>Open-Meteo's HTTP API for weather.</strong> The daily request limit ran out after about 15 full-period calls from a shared address. Weather and CAMS were read from Open-Meteo's open-data files on AWS instead.</li>
            <li><strong>Choosing stations by daily file counts.</strong> The archive has one file per station per day; a file can hold two hours or twenty-four. A first shortlist built on file counts left Europe with 316 usable stations out of 743 downloaded, so every European candidate was downloaded and measured by the hour.</li>
            <li><strong>An 80% coverage threshold in Asia.</strong> It produced a graph of Japan and Korea with no India. See Data.</li>
            <li><strong>Checkpoints that never came back.</strong> Training ran on Kaggle in 12-hour sessions. Kaggle unpacks uploaded archives and will not send a large dataset as one download, so two sessions started over before the checkpoints were renamed and fetched file by file.</li>
          </ul>
          <p>The full log, including time spent, is in <code>REPORT.md</code>; judgement calls are in <code>DECISIONS.md</code>.</p>
        </section>

        <section id="sources">
          <h2>Sources</h2>
          <ul className="prose-list">
            <li><strong>Observations:</strong> <a href="https://www.eea.europa.eu/en/datahub">European Environment Agency</a> air-quality download service, and <a href="https://openaq.org">OpenAQ</a>, open-data archive on AWS. OpenAQ aggregates data from many government and research providers, each under its own licence.</li>
            <li><strong>Fires:</strong> NASA <a href="https://firms.modaps.eosdis.nasa.gov">FIRMS</a>, VIIRS active fires from NOAA-21.</li>
            <li><strong>CAMS baseline and ERA5 weather:</strong> Copernicus Atmosphere Monitoring Service and Copernicus Climate Change Service, via <a href="https://open-meteo.com">Open-Meteo</a>'s open-data distribution.</li>
            <li><strong>Night lights:</strong> NASA Black Marble 2016, served by NASA GIBS. Public domain.</li>
            <li><strong>Coastlines and country borders:</strong> Natural Earth, public domain. <strong>City names:</strong> GeoNames, CC BY 4.0.</li>
          </ul>
        </section>
      </article>
    </div>
  )
}
