// Re-run existing e371fb5 browser scenarios without replacing historical evidence.
// All full screenshots/ZIP fixtures go to ignored temp output; curated results go beside this check folder.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const OUT = path.resolve('docs/development/release-gate-results')
mkdirSync(OUT, { recursive: true })
const runs = []
for (const [name, source] of [
  ['header', 'docs/development/header-collapse-results/check/header.mjs'],
  ['editor', 'docs/development/artwork-editor-results/check/editor.mjs'],
  ['ux', 'docs/development/m12-6-results/check/ux.mjs'],
]) {
  const temp = path.resolve('node_modules/.tmp/release-gate/browser', name)
  let code = readFileSync(source, 'utf8')
  code = code.replace(
    "'../../../../extension/integration/harness.mjs'",
    JSON.stringify(pathToFileURL(path.resolve('extension/integration/harness.mjs')).href),
  )
  code = code.replace(/const OUT = path.resolve\('[^']+'\)/, `const OUT = ${JSON.stringify(temp)}`)
  await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const json = readdirSync(temp).find((x) => x.endsWith('.json'))
  const result = JSON.parse(readFileSync(path.join(temp, json), 'utf8'))
  copyFileSync(path.join(temp, json), path.join(OUT, `${name}.json`))
  runs.push({
    name,
    source,
    checks: result.results.length,
    passed: result.results.filter((x) => x.pass).length,
  })
  for (const shot of name === 'header'
    ? ['cassette-1440x900-collapsed.png']
    : name === 'editor'
      ? ['cassette-390x844.png']
      : ['dashboard.png']) {
    if (readdirSync(temp).includes(shot))
      copyFileSync(path.join(temp, shot), path.join(OUT, `${name}-${shot}`))
  }
  console.log('GATE', JSON.stringify(runs.at(-1)))
  await delay(3000)
}
writeFileSync(
  path.join(OUT, 'browser-regression.json'),
  JSON.stringify({ candidate: 'e371fb5', runs }, null, 2) + '\n',
)
if (runs.some((x) => x.checks !== x.passed)) process.exitCode = 1
