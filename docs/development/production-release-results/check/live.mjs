// Live production UI in disposable profiles only. Synthetic data stays in those profiles.
// No normal browser profile, shared/server-side data or deployment settings are modified.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const OUT = path.resolve('docs/development/production-release-results')
mkdirSync(OUT, { recursive: true })
const runs = []
for (const [name, source] of [
  ['smoke', 'docs/development/release-gate-results/check/smoke.mjs'],
  ['ux', 'docs/development/m12-6-results/check/ux.mjs'],
]) {
  const temp = path.resolve('node_modules/.tmp/production-release/browser', name)
  mkdirSync(temp, { recursive: true })
  let code = readFileSync(source, 'utf8').replace(/\r\n/g, '\n')
  const importLine = code.match(
    /import \{ launch, BASE, (?:sleep, )?waitFor \} from '[^']+harness.mjs'/,
  )?.[0]
  assert(importLine, 'Expected explicit harness import')
  code = code.replace(
    importLine,
    importLine
      .replace('BASE, ', '')
      .replace(
        /'[^']+harness.mjs'/,
        JSON.stringify(pathToFileURL(path.resolve('extension/integration/harness.mjs')).href),
      ) + "\nconst BASE='https://39page.com'",
  )
  code = code.replace("from 'fflate'", `from ${JSON.stringify(import.meta.resolve('fflate'))}`)
  code = code.replace(/const OUT = path.resolve\('[^']+'\)/, `const OUT = ${JSON.stringify(temp)}`)
  code = code.replace(
    "candidate: 'e371fb5'",
    "candidate: 'cac19d56a5a4c4986fbead4cbf3156f2b7274e99'",
  )
  code = code.replace("date: '2026-11-15'", "date: '2026-11-16'")
  if (name === 'smoke') {
    const start = code.indexOf('  await ev(\n    `const f=')
    const end = code.indexOf("  record(\n    'Production bridge", start)
    assert(start >= 0 && end > start, 'Expected local bridge ancestry probe')
    // Production CSP intentionally prevents embedding. A top-level visit must still be refused by JS.
    code =
      code.slice(0, start) +
      `  const bridge=await h.tab(BASE+'/bridge');
  await waitFor(()=>bridge.ev("document.documentElement.dataset.bridge==='refused'"));
` +
      code.slice(end)
    code = code.replace(
      'Production bridge refuses web ancestry without touching storage',
      'Live bridge is disabled without touching storage',
    )
    const capture = "  await click('.capture-button')"
    assert(code.includes(capture))
    code = code.replace(
      capture,
      `  await click('.header-toggle');
  await waitFor(()=>ev("document.querySelector('.header-toggle').getAttribute('aria-expanded')==='false'"));
  await click('.header-toggle');
  await waitFor(()=>ev("document.querySelector('.header-toggle').getAttribute('aria-expanded')==='true'"));
  record('Live header collapse restores menus and iframe',await ev("window.__player===document.querySelector('.player-mount iframe')&&!document.querySelector('#dashboard-header-content').hidden"));
  await click('.theme-button:last-child');await click('.theme-button:first-child');
  record('Live theme changes preserve iframe',await ev("document.documentElement.dataset.theme==='kawaii-synth-cassette'&&window.__player===document.querySelector('.player-mount iframe')"));
` + capture,
    )
  }
  await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const file = readdirSync(temp).find((x) => x.endsWith('.json'))
  const result = JSON.parse(readFileSync(path.join(temp, file), 'utf8'))
  copyFileSync(path.join(temp, file), path.join(OUT, `${name}.json`))
  for (const shot of ['dashboard.png', 'cassette.png'])
    if (readdirSync(temp).includes(shot)) copyFileSync(path.join(temp, shot), path.join(OUT, shot))
  runs.push({
    name,
    origin: 'https://39page.com',
    checks: result.results.length,
    passed: result.results.filter((x) => x.pass).length,
  })
  console.log('LIVE', JSON.stringify(runs.at(-1)))
  await delay(3000)
}
writeFileSync(
  path.join(OUT, 'live-summary.json'),
  JSON.stringify({ commit: 'cac19d56a5a4c4986fbead4cbf3156f2b7274e99', runs }, null, 2) + '\n',
)
if (runs.some((x) => x.checks !== x.passed)) process.exitCode = 1
