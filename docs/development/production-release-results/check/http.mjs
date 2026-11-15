// Read-only deployed asset and response-header verification.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const OUT = path.resolve('docs/development/production-release-results')
mkdirSync(OUT, { recursive: true })
const sha = (b) => createHash('sha256').update(b).digest('hex')
const keep = [
  'content-type',
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'strict-transport-security',
  'location',
  'server',
]
const files = []
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, name.name)
    if (name.isDirectory()) walk(f)
    else if (name.name !== '_headers') files.push(f)
  }
}
walk('dist')
const results = []
for (const file of files) {
  const url = 'https://39page.com/' + path.relative('dist', file).split(path.sep).join('/')
  const r = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  })
  const bytes = Buffer.from(await r.arrayBuffer()),
    local = readFileSync(file)
  results.push({
    file,
    url,
    finalUrl: r.url,
    status: r.status,
    bytes: bytes.length,
    localSHA: sha(local),
    liveSHA: sha(bytes),
    pass: r.status === 200 && sha(local) === sha(bytes),
    headers: Object.fromEntries(
      keep.flatMap((k) => (r.headers.has(k) ? [[k, r.headers.get(k)]] : [])),
    ),
  })
}
for (const route of ['/bridge', '/bridge.html']) {
  const r = await fetch('https://39page.com' + route, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  })
  results.push({
    route,
    finalUrl: r.url,
    status: r.status,
    pass:
      r.status === 200 &&
      r.headers.get('content-security-policy') === "frame-ancestors 'none'" &&
      r.headers.get('x-content-type-options') === 'nosniff' &&
      r.headers.get('referrer-policy') === 'no-referrer',
    headers: Object.fromEntries(
      keep.flatMap((k) => (r.headers.has(k) ? [[k, r.headers.get(k)]] : [])),
    ),
  })
}
for (const url of ['http://39page.com/', 'https://www.39page.com/']) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  results.push({
    url,
    status: r.status,
    location: r.headers.get('location'),
    pass: r.status === 301 && r.headers.get('location') === 'https://39page.com/',
  })
}
writeFileSync(
  path.join(OUT, 'http.json'),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      commit: 'cac19d56a5a4c4986fbead4cbf3156f2b7274e99',
      results,
    },
    null,
    2,
  ) + '\n',
)
console.log(JSON.stringify(results, null, 2))
if (results.some((x) => !x.pass)) process.exitCode = 1
