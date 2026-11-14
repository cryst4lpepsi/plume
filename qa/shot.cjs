// Usage: node qa/shot.mjs <out.png> <url-hash> [width] [height] [query] [waitMs]
const { chromium } = require('playwright')
;(async () => {
const [out, hash = '/', w = '1440', h = '900', query = '', wait = '3500'] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(`http://127.0.0.1:5173/${query ? '?' + query : ''}#${hash}`)
await page.waitForTimeout(+wait)
if (process.env.EVAL) await page.evaluate(process.env.EVAL)
if (process.env.EVAL) await page.waitForTimeout(1800)
await page.screenshot({ path: out, timeout: 180000, fullPage: !!process.env.FULL, clip: process.env.CLIP ? JSON.parse(process.env.CLIP) : undefined })
console.log(out, errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'ok', 'frameMs', await page.evaluate(() => window.__plumeFrameMs))
await browser.close()
})()
