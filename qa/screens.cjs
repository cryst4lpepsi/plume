// Final screenshot set: every view at 1440, 1024 and 390 px -> docs/screenshots/.
// Headless Chromium has only software WebGL here, so the globe is rendered at ~2 fps via ?qa.
const { chromium } = require('playwright')
const os = require('os')
const { execFileSync } = require('child_process')
const SIZES = [[1440, 900], [1024, 768], [390, 844]]
const SHOTS = [
  ['globe-observed', '/', "__plume.setState({playing:false,mode:'observed',region:'both',sel:null})"],
  ['globe-forecast', '/', "__plume.setState({playing:false,mode:'forecast',region:'asia',horizon:12,sel:null})"],
  ['globe-error', '/', "__plume.setState({playing:false,mode:'error',region:'asia',horizon:12,sel:null})"],
  ['globe-influence', '/', "__plume.setState({playing:false,mode:'influence',region:'europe',sel:null})"],
  ['globe-drawer', '/', "__plume.setState({playing:false,mode:'observed',region:'both',sel:{region:'europe',station:110}})"],
  ['terminal', '/terminal', "__plume.setState({playing:false,region:'both',horizon:12})"],
  ['methods', '/methods', null],
]
;(async () => {
  const only = process.argv[2]
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const [w, h] of SIZES) for (const [name, hash, js] of SHOTS) {
    if (only && !name.includes(only)) continue
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w === 1440 && name === 'terminal' ? 2 : 1 })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
    await page.goto(`http://127.0.0.1:5173/?qa=${w < 600 ? 5 : 10}#${hash}`)
    await page.waitForTimeout(hash === '/' ? 6000 : 3500)
    if (js) { await page.evaluate(js); await page.waitForTimeout(hash === '/' ? 5000 : 1200) }
    const out = `docs/screenshots/${name}-${w}.png`
    if (name === 'methods') {
      // Long pages: software WebGL caps a capture at 8,192 px, so scroll, shoot each screenful and stitch.
      const total = await page.evaluate(() => document.documentElement.scrollHeight)
      const parts = []
      for (let y = 0, k = 0; y < total; y += h, k++) {
        const top = Math.min(y, Math.max(0, total - h))
        await page.evaluate((t) => window.scrollTo(0, t), top); await page.waitForTimeout(250)
        const f = `${os.tmpdir()}/plume-${name}-${w}-${k}.png`
        await page.screenshot({ path: f }); parts.push(`${f}:${top}`)
      }
      execFileSync('.venv/bin/python', ['qa/stitch.py', out, String(total), ...parts])
    } else await page.screenshot({ path: out, timeout: 240000 }) // viewport only: fixed bars land mid-page in a full-page capture
    console.log(`${name}-${w}`, errs.length ? 'ERRORS ' + errs[0].slice(0, 200) : 'ok')
    await page.close()
  }
  await browser.close()
})()
