// Self-hosted fonts (no CDN at runtime). System B won the selection in DECISIONS.md and is the default;
// the other candidates load only when ?fonts=<key> is present, which is how the test screenshots were made.
import '@fontsource-variable/brygada-1918/wght.css'
import '@fontsource-variable/brygada-1918/wght-italic.css'
import '@fontsource-variable/golos-text/wght.css'
import '@fontsource/iosevka/400.css'
import '@fontsource/iosevka/500.css'
import '@fontsource/iosevka/700.css'

export const FONT_SYSTEMS: Record<string, { label: string; load: () => Promise<unknown>; vars: Record<string, string> }> = {
  a: {
    label: 'A · Spectral / Hanken Grotesk / Commit Mono',
    load: () => Promise.all([import('@fontsource/spectral/300.css'), import('@fontsource/spectral/400.css'), import('@fontsource/spectral/400-italic.css'), import('@fontsource/spectral/500.css'),
      import('@fontsource-variable/hanken-grotesk/wght.css'), import('@fontsource/commit-mono/400.css'), import('@fontsource/commit-mono/700.css')]),
    vars: { '--font-display': "'Spectral', Georgia, serif", '--font-text': "'Hanken Grotesk Variable', sans-serif", '--font-mono': "'Commit Mono', monospace", '--display-weight': '400' },
  },
  b: {
    label: 'B · Brygada 1918 / Golos Text / Iosevka',
    load: () => Promise.resolve(),
    vars: { '--font-display': "'Brygada 1918 Variable', Georgia, serif", '--font-text': "'Golos Text Variable', sans-serif", '--font-mono': "'Iosevka', monospace", '--mono-scale': '1.08', '--display-weight': '500' },
  },
  c: {
    label: 'C · Archivo (expanded) / Archivo / Azeret Mono',
    load: () => Promise.all([import('@fontsource-variable/archivo/wdth.css'), import('@fontsource-variable/azeret-mono/wght.css')]),
    vars: { '--font-display': "'Archivo Variable', sans-serif", '--font-text': "'Archivo Variable', sans-serif", '--font-mono': "'Azeret Mono Variable', monospace", '--display-stretch': '118%', '--display-weight': '600', '--mono-scale': '0.96' },
  },
  f: {
    label: 'Fallback · Newsreader / Schibsted Grotesk / Martian Mono',
    load: () => Promise.all([import('@fontsource-variable/newsreader/opsz.css'), import('@fontsource-variable/schibsted-grotesk/wght.css'), import('@fontsource-variable/martian-mono/wdth.css')]),
    vars: { '--font-display': "'Newsreader Variable', Georgia, serif", '--font-text': "'Schibsted Grotesk Variable', sans-serif", '--font-mono': "'Martian Mono Variable', monospace", '--mono-scale': '1', '--display-weight': '500' },
  },
}

export async function applyFontSystem() {
  const key = new URLSearchParams(location.search).get('fonts')
  const sys = key ? FONT_SYSTEMS[key] : undefined
  if (!sys) return
  await sys.load()
  for (const [k, v] of Object.entries(sys.vars)) document.documentElement.style.setProperty(k, v)
  document.documentElement.dataset.fonts = key!
}
