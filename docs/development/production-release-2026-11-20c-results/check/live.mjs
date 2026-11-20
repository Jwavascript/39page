// 운영 39page.com 을 실제 Chrome 으로 — 버리는 임시 프로필 · 합성 데이터만 쓴다. 평소 브라우저 프로필 · 서버 쪽 데이터 ·
// 배포 설정은 건드리지 않는다. 2026-11-20 첫 배포의 회귀 확인(smoke · ux · queue · search · sharelink · sharecard)에 이번 기능
// 확인(share-dialog, ADR 0043)을 더해, 주소만 운영으로 바꿔 스크립트마다 따로 실행한다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/production-release-2026-11-20c-results/check/live.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const COMMIT = '7d494b0679680999fc7538cc14b46636848a9279'
const ORIGIN = 'https://39page.com'
const OUT = path.resolve('docs/development/production-release-2026-11-20c-results')
mkdirSync(OUT, { recursive: true })

const SCRIPTS = [
  // [이름, 원본, 남길 스크린샷]
  ['smoke', 'docs/development/release-gate-results/check/smoke.mjs', []],
  ['ux', 'docs/development/m12-6-results/check/ux.mjs', ['dashboard.png', 'cassette.png']],
  [
    'queue',
    'docs/development/playback-ux-results/check/queue.mjs',
    ['card-shuffle-repeat-all-1440.png'],
  ],
  ['search', 'docs/development/playback-ux-results/check/search.mjs', []],
  [
    'share-dialog',
    'docs/development/share-dialog-results/check/share-dialog.mjs',
    ['data-dialog-1440.png', 'share-dialog-1440.png', 'single-kawaii-moments.png', 'lp-mono.png'],
  ],
]
const only = process.argv.slice(2)

/** 로컬 확인 스크립트를 운영 주소로 돌리게 고친다 — 확인 내용은 바꾸지 않는다(운영에서 다른 점만 아래에 적는다). */
function forProduction(name, code, temp) {
  code = code.replace(/\r\n/g, '\n')
  const importLine = code.match(
    /import \{ launch, BASE, (?:sleep, )?waitFor \} from '[^']+harness\.mjs'/,
  )?.[0]
  assert(importLine, `${name}: expected the harness import`)
  code = code.replace(
    importLine,
    `${importLine
      .replace('BASE, ', '')
      .replace(
        /'[^']+harness\.mjs'/,
        JSON.stringify(pathToFileURL(path.resolve('extension/integration/harness.mjs')).href),
      )}\nconst BASE = ${JSON.stringify(ORIGIN)}`,
  )
  code = code.replace("from 'fflate'", `from ${JSON.stringify(import.meta.resolve('fflate'))}`)
  const out = /const OUT = path\.resolve\((?:process\.env\.OUT \?\? )?'[^']+'\)/
  assert(out.test(code), `${name}: expected OUT`)
  code = code.replace(out, `const OUT = ${JSON.stringify(temp)}`)
  code = code.replace("candidate: 'e371fb5'", `candidate: '${COMMIT}'`)
  code = code.replace("date: '2026-11-15'", "date: '2026-11-20'")

  if (name === 'smoke') {
    // 운영 CSP 는 브리지를 iframe 으로 넣는 것을 일부러 막는다 — 로컬 Gate 의 iframe 확인 대신 맨 위로 열어 거부되는지 본다
    // (2026-11-16 배포 때와 같은 바꿈).
    const start = code.indexOf('  await ev(\n    `const f=')
    const end = code.indexOf("  record(\n    'Production bridge", start)
    assert(start >= 0 && end > start, 'smoke: expected the local bridge ancestry probe')
    code = `${code.slice(0, start)}  const bridge = await h.tab(BASE + '/bridge')
  await waitFor(() => bridge.ev("document.documentElement.dataset.bridge==='refused'"))
${code.slice(end)}`
    code = code.replace(
      'Production bridge refuses web ancestry without touching storage',
      'Live bridge is disabled without touching storage',
    )
  }
  return code
}

const runs = []
for (const [name, source, shots] of SCRIPTS) {
  if (only.length > 0 && !only.includes(name)) continue
  const temp = path.resolve('node_modules/.tmp/production-release-2026-11-20c', name)
  rmSync(temp, { recursive: true, force: true })
  mkdirSync(temp, { recursive: true })
  const file = path.join(temp, 'run.mjs')
  writeFileSync(file, forProduction(name, readFileSync(source, 'utf8'), temp))
  const started = new Date().toISOString()
  const child = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    env: process.env,
    timeout: 15 * 60_000,
  })
  const json = readdirSync(temp).find((entry) => entry.endsWith('.json'))
  const result = json ? JSON.parse(readFileSync(path.join(temp, json), 'utf8')) : { results: [] }
  if (json) copyFileSync(path.join(temp, json), path.join(OUT, `${name}.json`))
  for (const shot of shots) {
    if (existsSync(path.join(temp, shot)))
      copyFileSync(path.join(temp, shot), path.join(OUT, `${name}-${shot}`))
  }
  const checks = result.results?.length ?? 0
  const passed = result.results?.filter((r) => r.pass).length ?? 0
  runs.push({ name, source, origin: ORIGIN, started, exitCode: child.status, checks, passed })
  console.log('LIVE', JSON.stringify(runs.at(-1)))
}

const summaryFile = path.join(OUT, 'live-summary.json')
const previous =
  existsSync(summaryFile) && only.length > 0
    ? JSON.parse(readFileSync(summaryFile, 'utf8')).runs
    : []
const merged = [...previous.filter((run) => !runs.some((r) => r.name === run.name)), ...runs]
writeFileSync(
  summaryFile,
  `${JSON.stringify({ observedAt: new Date().toISOString(), commit: COMMIT, runs: merged }, null, 2)}\n`,
)
if (runs.some((run) => run.exitCode !== 0 || run.passed !== run.checks || run.checks === 0))
  process.exitCode = 1
