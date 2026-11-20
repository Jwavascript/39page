// 읽기 전용 — 운영 39page.com 의 공개 자산이 로컬 빌드(배포 커밋)와 바이트까지 같은지, 응답 헤더 · 이동이 그대로인지 본다.
//
// 운영 빌드는 CI 환경 변수 `VITE_BRIDGE_EXTENSION_IDS`(Web Store 확장 ID, CWS 비공개 출시)를 넣어 만든다 — 브리지 JS ·
// bridge.html · `_headers` 가 그 값에 따라 달라진다. 같은 값으로 따로 빌드한 폴더를 `DIST` 로 주고, 브리지 응답 헤더는
// 그 빌드가 만든 `_headers` 와 비교한다(값을 이 스크립트에 박지 않는다). 결과 파일 이름은 `OUT_NAME`.
// 실행: VITE_BRIDGE_EXTENSION_IDS=<운영과 같은 ID> npx vite build --outDir <폴더>
//       DIST=<폴더> node docs/development/production-release-2026-11-20-results/check/http.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const COMMIT = 'b88ab35d3b4720dfb0fa36b595c09eca80bf3e3d'
const ORIGIN = 'https://39page.com'
const OUT = path.resolve('docs/development/production-release-2026-11-20-results')
mkdirSync(OUT, { recursive: true })
const DIST = process.env.DIST ?? 'dist'
const OUT_NAME = process.env.OUT_NAME ?? 'http.json'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const keep = [
  'content-type',
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'strict-transport-security',
  'location',
  'server',
]
const headersOf = (response) =>
  Object.fromEntries(
    keep.flatMap((k) => (response.headers.has(k) ? [[k, response.headers.get(k)]] : [])),
  )
const get = (url, init = {}) =>
  fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
    ...init,
  })

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    // `_headers` 는 배포 설정 파일이라 공개 자산이 아니다 — 실제 응답 헤더로 본다.
    else if (entry.name !== '_headers') files.push(file)
  }
}
walk(DIST)

const results = []
for (const file of files) {
  const url = `${ORIGIN}/${path.relative(DIST, file).split(path.sep).join('/')}`
  const response = await get(url)
  const bytes = Buffer.from(await response.arrayBuffer())
  const local = readFileSync(file)
  results.push({
    file: path.relative(DIST, file).split(path.sep).join('/'),
    url,
    finalUrl: response.url,
    status: response.status,
    bytes: bytes.length,
    localSHA: sha(local),
    liveSHA: sha(bytes),
    pass: response.status === 200 && sha(local) === sha(bytes),
    headers: headersOf(response),
  })
}

// 첫 화면 `/` 도 index.html 과 같은 바이트여야 한다.
{
  const response = await get(`${ORIGIN}/`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const local = readFileSync(path.join(DIST, 'index.html'))
  results.push({
    route: '/',
    finalUrl: response.url,
    status: response.status,
    liveSHA: sha(bytes),
    localSHA: sha(local),
    pass: response.status === 200 && sha(bytes) === sha(local),
    headers: headersOf(response),
  })
}

/** 빌드가 만든 `_headers` 에서 그 경로의 헤더를 읽는다. */
function builtHeaders(route) {
  const lines = readFileSync(path.join(DIST, '_headers'), 'utf8').split(/\r?\n/)
  const start = lines.indexOf(route)
  assert(start >= 0, `_headers has no ${route}`)
  const headers = {}
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break
    const at = line.indexOf(':')
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return headers
}

for (const route of ['/bridge', '/bridge.html']) {
  const response = await get(ORIGIN + route)
  const expected = builtHeaders(route)
  results.push({
    route,
    finalUrl: response.url,
    status: response.status,
    expected,
    pass:
      response.status === 200 &&
      Object.keys(expected).length > 0 &&
      Object.entries(expected).every(([name, value]) => response.headers.get(name) === value),
    headers: headersOf(response),
  })
}

for (const url of ['http://39page.com/', 'https://www.39page.com/']) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  results.push({
    url,
    status: response.status,
    location: response.headers.get('location'),
    pass: response.status === 301 && response.headers.get('location') === 'https://39page.com/',
  })
}

writeFileSync(
  path.join(OUT, OUT_NAME),
  `${JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      commit: COMMIT,
      dist: DIST,
      bridgeExtensionIds: process.env.VITE_BRIDGE_EXTENSION_IDS ?? null,
      results,
    },
    null,
    2,
  )}\n`,
)
for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.file ?? r.route ?? r.url, r.status)
console.log(`${results.filter((r) => r.pass).length}/${results.length}`)
if (results.some((r) => !r.pass)) process.exitCode = 1
