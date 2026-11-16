// Frame rate of the Globe view in default and low-power modes -> results/frame_rate.json.
// Counts requestAnimationFrame callbacks over a fixed window. Records the WebGL renderer string, because
// in a container without a GPU this measures software rendering, not what a visitor's machine would do.
const { chromium } = require('playwright')
const fs = require('fs')
const { execSync } = require('child_process')
const SECONDS = 12
;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:5173/#/')
  await page.waitForSelector('canvas', { timeout: 60000 }); await page.waitForTimeout(8000)
  const count = () => page.evaluate((s) => new Promise((res) => {
    let n = 0; const t0 = performance.now()
    const tick = () => { n++; performance.now() - t0 < s * 1000 ? requestAnimationFrame(tick) : res(n / ((performance.now() - t0) / 1000)) }
    requestAnimationFrame(tick)
  }), SECONDS)
  const label = () => page.evaluate(() => [...document.querySelectorAll('button, a')].map((e) => e.textContent).find((t) => /Low-power rendering/.test(t || '')))
  const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  const modes = []
  const first = await label(); modes.push({ mode: /on/.test(first) ? 'low-power' : 'default', label: first, fps: +(await count()).toFixed(2) })
  await page.getByText(/Low-power rendering/).click(); await page.waitForTimeout(6000)
  const second = await label(); modes.push({ mode: /on/.test(second) ? 'low-power' : 'default', label: second, fps: +(await count()).toFixed(2) })
  const out = { script: 'qa/fps.cjs', commit: execSync('git rev-parse --short HEAD').toString().trim(), viewport: [1440, 900], window_s: SECONDS, renderer,
    software_rendering: /swiftshader|llvmpipe|software/i.test(renderer), modes,
    note: 'requestAnimationFrame callbacks per second with the replay paused. With a software renderer this is not representative of a machine with a GPU.' }
  fs.writeFileSync('results/frame_rate.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out))
  await browser.close()
})()
