import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { BANDS, oklchToSrgb8, rampColor } from '../lib/pm'
import { REGIONS, latLonToVec, originIndex, type RegionKey } from '../lib/data'
import { type DataSet, stationValue, inView } from '../lib/derive'
import { getState, setState, useStore, useHour, QA } from '../lib/store'
import * as S from './shaders'

const D2R = Math.PI / 180
const BOUNDS = new THREE.Vector4(S.FIELD.lon0 * D2R, S.FIELD.lon1 * D2R, S.FIELD.lat0 * D2R, S.FIELD.lat1 * D2R)
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---- shared textures -------------------------------------------------------------------------
function makeRamp(): THREE.DataTexture {
  const w = 256, px = new Uint8Array(w * 2 * 4)
  const err = [[0.4, 0.06, 255], [0.56, 0.11, 272], [0.76, 0.12, 318], [0.93, 0.05, 330]]
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1)
    // invert rampT: sample the band-centre interpolation directly in ramp space
    const x = t * BANDS.length - 0.5
    const k = Math.max(0, Math.min(BANDS.length - 2, Math.floor(x))), f = Math.max(0, Math.min(1, x - k))
    const a = BANDS[k], b = BANDS[k + 1]
    let dh = b.h - a.h; if (dh > 180) dh -= 360; if (dh < -180) dh += 360
    px.set([...oklchToSrgb8(a.l + (b.l - a.l) * f, a.c + (b.c - a.c) * f, a.h + dh * f), 255], i * 4)
    const y = t * (err.length - 1), j = Math.min(err.length - 2, Math.floor(y)), g = y - j
    px.set([...oklchToSrgb8(err[j][0] + (err[j + 1][0] - err[j][0]) * g, err[j][1] + (err[j + 1][1] - err[j][1]) * g, err[j][2] + (err[j + 1][2] - err[j][2]) * g), 255], (w + i) * 4)
  }
  const tex = new THREE.DataTexture(px, w, 2, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}
void rampColor

function makeNoise(): THREE.DataTexture {
  // tileable value noise, two channels at different base frequencies, 4 octaves each
  const n = 256, px = new Uint8Array(n * n * 4)
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const layer = (freq: number) => {
    const g = new Float32Array(freq * freq).map(rnd)
    return (x: number, y: number) => {
      const fx = (x / n) * freq, fy = (y / n) * freq
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const at = (i: number, j: number) => g[(j % freq) * freq + (i % freq)]
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
    }
  }
  const chans = [[4, 8, 16, 32], [8, 16, 32, 64]].map((fs) => fs.map(layer))
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4
    chans.forEach((ls, c) => { let v = 0, a = 0.5; for (const l of ls) { v += a * l(x, y); a *= 0.5 } px[i + c] = Math.round((v / 0.9375) * 255) })
    px[i + 3] = 255
  }
  const tex = new THREE.DataTexture(px, n, n, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true; tex.needsUpdate = true
  return tex
}

interface Shared { ramp: THREE.DataTexture; noise: THREE.DataTexture; pos: Float32Array; n: number; offset: Record<RegionKey, number> }
function useShared(ds: DataSet): Shared {
  return useMemo(() => {
    const n = ds.europe.n + ds.asia.n
    const pos = new Float32Array(n * 3)
    pos.set(ds.europe.pos, 0); pos.set(ds.asia.pos, ds.europe.n * 3)
    return { ramp: makeRamp(), noise: makeNoise(), pos, n, offset: { europe: 0, asia: ds.europe.n } }
  }, [ds])
}

function fillValues(ds: DataSet, sh: Shared, hour: number, out: Float32Array, stride: number, at: number) {
  const { mode, horizon, region } = getState()
  for (const r of REGIONS) {
    const d = ds[r], off = sh.offset[r], show = inView(region, r)
    for (let s = 0; s < d.n; s++) {
      const v = show ? stationValue(d, s, hour, mode, horizon) : NaN
      out[(off + s) * stride + at] = Number.isNaN(v) ? -1 : v
    }
  }
}

// ---- Earth, coastline ------------------------------------------------------------------------
function Earth({ segments = 96 }: { segments?: number }) {
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'tex/black-marble-2016.jpg')
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    return t
  }, [])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: S.earthVert, fragmentShader: S.earthFrag,
    uniforms: { uMap: { value: tex }, uLights: { value: 0.5 }, uInk: { value: new THREE.Color().setRGB(0.028, 0.038, 0.062) } },
  }), [tex])
  return <mesh material={mat}><sphereGeometry args={[1, segments, segments / 2]} /></mesh>
}

function Coast() {
  const ref = useRef<THREE.LineSegments>(null)
  useEffect(() => {
    let dead = false
    fetch(import.meta.env.BASE_URL + 'data/coast.bin').then((r) => r.arrayBuffer()).then((buf) => {
      if (dead || !ref.current) return
      const n = new Uint32Array(buf, 0, 1)[0], seg = new Int16Array(buf, 4, n * 4)
      const p = new Float32Array(n * 6)
      for (let i = 0; i < n; i++) {
        p.set(latLonToVec(seg[i * 4 + 1] / 100, seg[i * 4] / 100, 1.0012), i * 6)
        p.set(latLonToVec(seg[i * 4 + 3] / 100, seg[i * 4 + 2] / 100, 1.0012), i * 6 + 3)
      }
      ref.current.geometry.setAttribute('position', new THREE.BufferAttribute(p, 3))
    })
    return () => { dead = true }
  }, [])
  return (
    <lineSegments ref={ref} frustumCulled={false}>
      <bufferGeometry />
      <lineBasicMaterial color={new THREE.Color().setRGB(0.17, 0.22, 0.33)} transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  )
}

// ---- atmosphere ------------------------------------------------------------------------------
function Atmosphere({ ds, sh }: { ds: DataSet; sh: Shared }) {
  const gl = useThree((s) => s.gl)
  const hour = useHour()
  const mode = useStore((s) => s.mode), horizon = useStore((s) => s.horizon), region = useStore((s) => s.region)
  const lowPower = useStore((s) => s.lowPower)
  const pass = useMemo(() => {
    const mk = () => new THREE.WebGLRenderTarget(S.FIELD.w, S.FIELD.h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false })
    const st = new THREE.DataTexture(new Float32Array(sh.n * 4), sh.n, 1, THREE.RGBAFormat, THREE.FloatType)
    const wd = new THREE.DataTexture(new Float32Array(sh.n * 4), sh.n, 1, THREE.RGBAFormat, THREE.FloatType)
    for (let i = 0; i < sh.n; i++) (st.image.data as Float32Array).set(sh.pos.subarray(i * 3, i * 3 + 3), i * 4)
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: S.fieldVert, fragmentShader: S.fieldFrag, depthTest: false,
      uniforms: { uStations: { value: st }, uWind: { value: wd }, uN: { value: sh.n }, uBounds: { value: BOUNDS } },
    })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    return { a: mk(), b: mk(), st, wd, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
  }, [sh])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: S.atmoVert, fragmentShader: S.atmoFrag, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: {
      uFieldA: { value: pass.a.texture }, uFieldB: { value: pass.b.texture }, uRamp: { value: sh.ramp }, uNoise: { value: sh.noise },
      uMix: { value: 0 }, uTime: { value: 0 }, uR0: { value: 1.002 }, uR1: { value: 1.075 }, uGain: { value: 1 }, uErr: { value: 0 },
      uDim: { value: 1 }, uSteps: { value: 10 }, uBounds: { value: BOUNDS },
    },
  }), [pass, sh])

  // re-interpolate the field for this hour (A) and the next (B); the shader cross-fades between them
  useEffect(() => {
    const render = (h: number, target: THREE.WebGLRenderTarget) => {
      const sd = pass.st.image.data as Float32Array, wd = pass.wd.image.data as Float32Array
      fillValues(ds, sh, h, sd, 4, 3)
      for (const r of REGIONS) {
        const d = ds[r], off = sh.offset[r], hh = Math.max(0, Math.min(d.hours - 1, h))
        for (let s = 0; s < d.n; s++) { wd[(off + s) * 4] = d.wind[(hh * d.n + s) * 2] / 8; wd[(off + s) * 4 + 1] = d.wind[(hh * d.n + s) * 2 + 1] / 8 }
      }
      pass.st.needsUpdate = true; pass.wd.needsUpdate = true
      const prev = gl.getRenderTarget()
      gl.setRenderTarget(target); gl.render(pass.scene, pass.cam); gl.setRenderTarget(prev)
    }
    render(hour, pass.a); render(hour + 1, pass.b)
  }, [hour, mode, horizon, region, ds, sh, pass, gl])

  useFrame((state) => {
    const s = getState()
    const u = mat.uniforms
    u.uMix.value = s.hour - Math.floor(s.hour)
    if (!reducedMotion()) u.uTime.value = state.clock.elapsedTime
    u.uSteps.value = s.lowPower ? 5 : 10
    if (QA) u.uSteps.value = Number(QA) || 10
    u.uErr.value = s.mode === 'error' ? 1 : 0
    u.uDim.value += ((s.mode === 'influence' ? 0.45 : 1) - u.uDim.value) * 0.08
  })
  void lowPower
  return <mesh material={mat} renderOrder={2}><sphereGeometry args={[1.075, 96, 48]} /></mesh>
}

// ---- stations --------------------------------------------------------------------------------
function Stations({ ds, sh, size = 5 }: { ds: DataSet; sh: Shared; size?: number }) {
  const hour = useHour()
  const mode = useStore((s) => s.mode), horizon = useStore((s) => s.horizon), region = useStore((s) => s.region), sel = useStore((s) => s.sel)
  const dpr = useThree((s) => s.viewport.dpr)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(sh.pos, 3))
    g.setAttribute('aValue', new THREE.BufferAttribute(new Float32Array(sh.n), 1))
    g.setAttribute('aSel', new THREE.BufferAttribute(new Float32Array(sh.n), 1))
    return g
  }, [sh])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: S.pointsVert, fragmentShader: S.pointsFrag, transparent: true, depthWrite: false,
    uniforms: { uSize: { value: size }, uPx: { value: 1 }, uRamp: { value: sh.ramp }, uErr: { value: 0 } },
  }), [sh, size])
  useEffect(() => {
    const a = geo.getAttribute('aValue') as THREE.BufferAttribute
    fillValues(ds, sh, hour, a.array as Float32Array, 1, 0)
    // hidden regions: push far negative so the shader can drop them entirely
    for (const r of REGIONS) if (!inView(region, r)) (a.array as Float32Array).fill(-2, sh.offset[r], sh.offset[r] + ds[r].n)
    a.needsUpdate = true
    mat.uniforms.uErr.value = mode === 'error' ? 1 : 0
  }, [hour, mode, horizon, region, ds, sh, geo, mat])
  useEffect(() => {
    const a = geo.getAttribute('aSel') as THREE.BufferAttribute
    ;(a.array as Float32Array).fill(0)
    if (sel) (a.array as Float32Array)[sh.offset[sel.region] + sel.station] = 1
    a.needsUpdate = true
  }, [sel, geo, sh])
  mat.uniforms.uPx.value = dpr
  return <points geometry={geo} material={mat} renderOrder={3} frustumCulled={false} />
}

// ---- influence arcs --------------------------------------------------------------------------
const ARC_SEG = 18
function Arcs({ ds, sh }: { ds: DataSet; sh: Shared }) {
  const hour = useHour()
  const mode = useStore((s) => s.mode), region = useStore((s) => s.region), sel = useStore((s) => s.sel)
  const built = useMemo(() => {
    const edges: { r: RegionKey; e: number; a: number; b: number }[] = []
    for (const r of REGIONS) ds[r].edges.forEach(([a, b], e) => edges.push({ r, e, a: sh.offset[r] + a, b: sh.offset[r] + b }))
    const E = edges.length
    const mk = (perEdge: number, tOf: (k: number) => number) => {
      const src = new Float32Array(E * perEdge * 3), dst = new Float32Array(E * perEdge * 3)
      const t = new Float32Array(E * perEdge), ph = new Float32Array(E * perEdge), w = new Float32Array(E * perEdge)
      edges.forEach((ed, i) => {
        for (let k = 0; k < perEdge; k++) {
          const j = i * perEdge + k
          src.set(sh.pos.subarray(ed.a * 3, ed.a * 3 + 3), j * 3); dst.set(sh.pos.subarray(ed.b * 3, ed.b * 3 + 3), j * 3)
          t[j] = tOf(k); ph[j] = ((i * 0.6180339887) % 1 + k * 0.5) % 1
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(src.slice(), 3))
      g.setAttribute('aSrc', new THREE.BufferAttribute(src, 3)); g.setAttribute('aDst', new THREE.BufferAttribute(dst, 3))
      g.setAttribute('aT', new THREE.BufferAttribute(t, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1))
      g.setAttribute('aW', new THREE.BufferAttribute(w, 1))
      return g
    }
    const lines = mk(ARC_SEG * 2, (k) => (Math.floor(k / 2) + (k % 2)) / ARC_SEG)
    const parts = mk(2, () => 0)
    const first: Record<RegionKey, number> = { europe: 0, asia: ds.europe.edges.length }
    const uni = (p: number) => ({ uTime: { value: 0 }, uPx: { value: 1 }, uParticle: { value: p }, uColor: { value: new THREE.Color().setRGB(0.86, 0.92, 1.0) } })
    const lm = new THREE.ShaderMaterial({ vertexShader: S.arcVert, fragmentShader: S.arcFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: uni(0) })
    const pm = new THREE.ShaderMaterial({ vertexShader: S.arcVert, fragmentShader: S.arcFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: uni(1) })
    return { lines, parts, first, lm, pm, E }
  }, [ds, sh])
  useEffect(() => {
    const w = new Float32Array(built.E)
    if (mode === 'influence') for (const r of REGIONS) {
      if (!inView(region, r)) continue
      const d = ds[r], o = originIndex(d, hour), E = d.edges.length
      const row = d.att.subarray(o * E, (o + 1) * E)
      // draw the 260 strongest edges of this issue; with a station selected, its own incoming edges always show
      const cut = Array.from(row).sort((p, q) => q - p)[Math.min(E - 1, 260)]
      for (let e = 0; e < E; e++) {
        const mine = sel && sel.region === r && d.edges[e][1] === sel.station
        if (row[e] < cut && !mine) continue
        let v = row[e] / 255
        if (sel && !mine) v *= sel.region === r ? 0.12 : 0.4
        if (mine) v = Math.max(v, 0.15)
        w[built.first[r] + e] = v
      }
    }
    for (const [g, per] of [[built.lines, ARC_SEG * 2], [built.parts, 2]] as const) {
      const a = g.getAttribute('aW') as THREE.BufferAttribute, arr = a.array as Float32Array
      for (let i = 0; i < built.E; i++) arr.fill(w[i], i * per, (i + 1) * per)
      a.needsUpdate = true
    }
  }, [hour, mode, region, sel, ds, built])
  const dpr = useThree((s) => s.viewport.dpr)
  useFrame((st) => {
    built.pm.uniforms.uPx.value = dpr
    if (!reducedMotion()) built.pm.uniforms.uTime.value = st.clock.elapsedTime
  })
  if (mode !== 'influence') return null
  return (
    <>
      <lineSegments geometry={built.lines} material={built.lm} renderOrder={4} frustumCulled={false} />
      {!reducedMotion() && <points geometry={built.parts} material={built.pm} renderOrder={5} frustumCulled={false} />}
    </>
  )
}

// ---- camera ----------------------------------------------------------------------------------
const VIEW: Record<string, [number, number, number]> = { europe: [47, 12, 2.7], asia: [27, 104, 3.1], both: [36, 62, 4.5] }
function Rig({ ds, sh, onHover }: { ds: DataSet; sh: Shared; onHover: (h: { region: RegionKey; station: number; x: number; y: number } | null) => void }) {
  const { camera, gl, size } = useThree()
  const ctl = useRef<any>(null)
  const sel = useStore((s) => s.sel), region = useStore((s) => s.region)
  const fly = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null)
  const idle = useRef(true)
  const flyTo = (lat: number, lon: number, dist: number) => {
    fly.current = { from: camera.position.clone(), to: new THREE.Vector3(...latLonToVec(lat, lon, dist)), t: 0 }
  }
  useEffect(() => { camera.position.set(...latLonToVec(...VIEW.both)); camera.lookAt(0, 0, 0) }, [camera])
  // the timeline covers the bottom of the canvas; shift the projection so the globe is centred in what remains
  useEffect(() => {
    const foot = size.width < 640 ? 150 : 165
    ;(camera as THREE.PerspectiveCamera).setViewOffset(size.width, size.height, 0, foot / 2, size.width, size.height)
    return () => (camera as THREE.PerspectiveCamera).clearViewOffset()
  }, [camera, size])
  useEffect(() => { if (sel) { idle.current = false; const s = ds[sel.region].stations[sel.station]; flyTo(s.lat - 5, s.lon, 2.15) } }, [sel]) // eslint-disable-line
  const firstRegion = useRef(true)
  useEffect(() => { if (firstRegion.current) { firstRegion.current = false; return } idle.current = false; flyTo(...VIEW[region]) }, [region]) // eslint-disable-line
  useFrame((st, dt) => {
    const f = fly.current
    if (f) {
      f.t = Math.min(1, f.t + dt / (reducedMotion() ? 0.01 : 1.1))
      const e = 1 - Math.pow(1 - f.t, 4) // ease-out quart
      const a = f.from.clone().normalize(), b = f.to.clone().normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(a, b)
      const dir = a.applyQuaternion(new THREE.Quaternion().slerp(q, e))
      camera.position.copy(dir.multiplyScalar(f.from.length() + (f.to.length() - f.from.length()) * e))
      if (f.t >= 1) fly.current = null
    } else if (idle.current && !reducedMotion()) {
      // slow drift between Europe and Asia until the first interaction
      const k = 0.5 - 0.5 * Math.cos(st.clock.elapsedTime * 0.045)
      const lat = VIEW.europe[0] + (VIEW.asia[0] - VIEW.europe[0]) * k, lon = VIEW.europe[1] + 14 + (VIEW.asia[1] - VIEW.europe[1] - 28) * k
      const want = new THREE.Vector3(...latLonToVec(lat, lon, 3.5 + 0.2 * Math.sin(st.clock.elapsedTime * 0.09)))
      camera.position.lerp(want, 1 - Math.exp(-dt * 0.6))
    }
    ctl.current?.update()
  })
  // picking: nearest front-facing station within 12 px of the pointer
  useEffect(() => {
    const el = gl.domElement
    const v = new THREE.Vector3()
    let down: [number, number] | null = null
    const pick = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top
      const cam = camera.position.clone().normalize()
      const view = getState().region
      let best = -1, bd = 12 * 12
      for (let i = 0; i < sh.n; i++) {
        const r: RegionKey = i < sh.offset.asia ? 'europe' : 'asia'
        if (!inView(view, r)) continue
        v.set(sh.pos[i * 3], sh.pos[i * 3 + 1], sh.pos[i * 3 + 2])
        if (v.dot(cam) < 0.15) continue
        v.project(camera)
        const dx = (v.x * 0.5 + 0.5) * rect.width - px, dy = (-v.y * 0.5 + 0.5) * rect.height - py
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = i }
      }
      if (best < 0) return null
      const r: RegionKey = best < sh.offset.asia ? 'europe' : 'asia'
      return { region: r, station: best - sh.offset[r], x: px, y: py }
    }
    const move = (ev: PointerEvent) => { const h = pick(ev); onHover(h); el.style.cursor = h ? 'pointer' : 'grab' }
    const dn = (ev: PointerEvent) => { down = [ev.clientX, ev.clientY]; idle.current = false }
    const up = (ev: PointerEvent) => {
      if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) { const h = pick(ev); if (h) setState({ sel: { region: h.region, station: h.station } }) }
      down = null
    }
    const leave = () => onHover(null)
    const wheel = () => { idle.current = false }
    el.addEventListener('pointermove', move); el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave); el.addEventListener('wheel', wheel, { passive: true })
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerdown', dn); el.removeEventListener('pointerup', up); el.removeEventListener('pointerleave', leave); el.removeEventListener('wheel', wheel) }
  }, [gl, camera, sh, onHover, size])
  return <OrbitControls ref={ctl} enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.6} minDistance={1.35} maxDistance={6} />
}

/** QA only: render about two frames a second so software WebGL does not starve the page. */
function QaTicker() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { const id = setInterval(() => invalidate(), 500); return () => clearInterval(id) }, [invalidate])
  return null
}

// ---- frame-time watchdog ---------------------------------------------------------------------
function Watchdog() {
  const acc = useRef({ n: 0, sum: 0, warm: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    if (a.warm < 90) { a.warm++; return }           // ignore shader compilation and first uploads
    a.n++; a.sum += dt
    ;(window as any).__plumeFrameMs = (a.sum / a.n) * 1000
    if (a.n >= 120) {
      const ms = (a.sum / a.n) * 1000
      if (ms > 28 && !getState().lowPower && !QA) setState({ lowPower: true, lowPowerAuto: true })
      a.n = 0; a.sum = 0
    }
  })
  return null
}

export function Globe({ ds, onHover }: { ds: DataSet; onHover: (h: { region: RegionKey; station: number; x: number; y: number } | null) => void }) {
  const sh = useShared(ds)
  const lowPower = useStore((s) => s.lowPower)
  const small = typeof window !== 'undefined' && window.innerWidth < 600
  return (
    <Canvas flat frameloop={QA ? 'demand' : 'always'} dpr={lowPower ? 0.6 : small ? 1 : [1, 1.5]} camera={{ fov: 32, near: 0.1, far: 50 }} gl={{ antialias: !lowPower, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }} aria-hidden="true">
      <color attach="background" args={[new THREE.Color().setRGB(0.012, 0.016, 0.03)]} />
      <Earth segments={small ? 48 : 96} />
      <Coast />
      <Atmosphere ds={ds} sh={sh} />
      <Stations ds={ds} sh={sh} size={small ? 6 : 5} />
      <Arcs ds={ds} sh={sh} />
      <Rig ds={ds} sh={sh} onHover={onHover} />
      <Watchdog />
      {QA && <QaTicker />}
      {!lowPower && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.12} intensity={0.55} radius={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  )
}

/** Small low-detail globe for the terminal: Earth, coast and station points only, following the selection. */
function MiniRig({ ds }: { ds: DataSet }) {
  const { camera, invalidate } = useThree()
  const sel = useStore((s) => s.sel), region = useStore((s) => s.region)
  const want = useRef(new THREE.Vector3(...latLonToVec(...VIEW.both)))
  useEffect(() => {
    if (sel) { const s = ds[sel.region].stations[sel.station]; want.current.set(...latLonToVec(s.lat, s.lon, 2.5)) }
    else want.current.set(...latLonToVec(VIEW[region][0], VIEW[region][1], 3.1))
    invalidate()
  }, [sel, region, ds, invalidate])
  useFrame((_, dt) => {
    if (camera.position.distanceTo(want.current) > 0.002) {
      camera.position.lerp(want.current, reducedMotion() ? 1 : 1 - Math.exp(-dt * 5)); camera.lookAt(0, 0, 0); invalidate()
    }
  })
  return null
}
export function MiniGlobe({ ds }: { ds: DataSet }) {
  const sh = useShared(ds)
  const hour = useHour()
  return (
    <Canvas flat dpr={1} frameloop="demand" camera={{ fov: 30, near: 0.1, far: 50, position: latLonToVec(...VIEW.both) }} gl={{ antialias: true }} aria-hidden="true" key="mini">
      <color attach="background" args={[new THREE.Color().setRGB(0.014, 0.019, 0.034)]} />
      <Earth segments={48} />
      <Coast />
      <Stations ds={ds} sh={sh} size={4.5} />
      <MiniRig ds={ds} />
      <Invalidate dep={hour} />
    </Canvas>
  )
}
function Invalidate({ dep }: { dep: unknown }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() }, [dep, invalidate])
  return null
}
