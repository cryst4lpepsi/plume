// Types every terminal command, a typo and an unknown station into the command bar and prints the status line.
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:5173/?qa=5#/terminal')
  await page.waitForSelector('#cmd-in', { timeout: 60000 })
  await page.waitForTimeout(2500)
  const cmds = ['HELP', 'WATCH', 'MOVERS', 'ALERTS', 'SCORE', 'COMPARE', 'DETAIL', 'HORIZON 12', 'HORIZON 40', 'HORIZON', 'REGION ASIA', 'REGION INDIA', 'REGION MARS', 'REGION BOTH',
    'PAUSE', 'PLAY', 'PAUSE', 'PIN Warsaw', 'PIN Warsaw', 'UNPIN Warsaw', 'UNPIN Atlantis', 'Seoul', 'berlin', 'MOVRS', 'ALERT', 'Xyzzyville', 'help']
  let fail = 0
  for (const c of cmds) {
    await page.keyboard.press('Escape')
    await page.click('#cmd-in')
    await page.fill('#cmd-in', c)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    const msg = await page.textContent('.cmd-msg')
    const bad = await page.evaluate(() => document.querySelector('.cmd-msg').classList.contains('bad'))
    const st = await page.evaluate(() => { const s = window.__plume.getState(); return `h=${s.horizon} r=${s.region} play=${s.playing} sel=${s.sel ? s.sel.region + ':' + s.sel.station : '-'} focus=${document.activeElement?.id || document.activeElement?.tagName}` })
    const help = await page.evaluate(() => !!document.querySelector('.cmd-help'))
    console.log(`${c.padEnd(16)} ${bad ? 'ERR' : 'ok '} ${help ? '[help open] ' : ''}${msg}  {${st}}`)
    if (!msg) fail++
  }
  // history: up arrow recalls the last command
  await page.click('#cmd-in'); await page.keyboard.press('ArrowUp')
  console.log('history recall  ->', JSON.stringify(await page.inputValue('#cmd-in')))
  // autocomplete: typing a prefix lists suggestions
  await page.fill('#cmd-in', 'ho'); await page.waitForTimeout(200)
  console.log('autocomplete ho ->', await page.$$eval('.cmd-sugg li span:first-child', (e) => e.map((x) => x.textContent).join(' | ')))
  // digit shortcut focuses a panel
  await page.keyboard.press('Escape'); await page.keyboard.press('3')
  console.log('key 3 focus     ->', await page.evaluate(() => document.activeElement?.id))
  await page.keyboard.press('/')
  console.log('key / focus     ->', await page.evaluate(() => document.activeElement?.id))
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
