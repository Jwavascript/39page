// Read-only public HTTP/Git evidence. No authenticated Cloudflare changes or browser profile access.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { createHash } from 'node:crypto'

const OUT = path.resolve('docs/development/release-gate-results')
const LEGACY = path.resolve('node_modules/.tmp/release-gate/live-m10')
mkdirSync(OUT, { recursive: true })
mkdirSync(LEGACY, { recursive: true })
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const candidate = git('rev-parse', 'e371fb5')
const refs = [
  'f5a4932',
  'a1259a3',
  'db968bf',
  '1db699e',
  'fd4b995',
  '7ebc67b',
  '8884ae1',
  'bbaa80c',
  '325226d',
  'b73c96e',
  'e65f8c7',
  'f2b290f',
  'f304cce',
  '850a45e',
  '80a4cd3',
  'e371fb5',
  '2bc8fd2',
]
const mergeTree = git('merge-tree', '--write-tree', '--messages', candidate, 'origin/main').split(
  '\n',
)[0]
const snapshot = {
  observedAt: new Date().toISOString(),
  candidate,
  remoteHeads: git('ls-remote', '--heads', 'origin'),
  ancestry: refs.map((ref) => ({
    ref,
    included: spawnSync('git', ['merge-base', '--is-ancestor', ref, candidate]).status === 0,
  })),
  mergeSimulation: {
    tree: mergeTree,
    applied: false,
    diffFromCandidate: git('diff', '--name-only', candidate, mergeTree),
  },
  http: [],
  files: [],
  github: {},
}
const keep = [
  'server',
  'content-type',
  'cache-control',
  'content-security-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'permissions-policy',
  'location',
]
async function inspect(url) {
  const hops = []
  for (let n = 0; n < 7; n++) {
    const r = await fetch(url, { redirect: 'manual' })
    hops.push({
      url,
      status: r.status,
      headers: Object.fromEntries(
        keep.flatMap((k) => (r.headers.has(k) ? [[k, r.headers.get(k)]] : [])),
      ),
    })
    if (r.status >= 300 && r.status < 400 && r.headers.has('location')) {
      url = new URL(r.headers.get('location'), url).href
      continue
    }
    const bytes = Buffer.from(await r.arrayBuffer())
    return { hops, bytes }
  }
  throw Error('redirect loop')
}
for (const url of [
  'https://39page.com/',
  'http://39page.com/release-gate-read-only?gate=1',
  'https://www.39page.com/release-gate-read-only?gate=1',
  'https://39page.com/bridge',
  'https://39page.com/bridge.html',
]) {
  const { hops, bytes } = await inspect(url)
  snapshot.http.push({
    requested: url,
    hops,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  if (url === 'https://39page.com/') writeFileSync(path.join(LEGACY, 'index.html'), bytes)
}
const html = readFileSync(path.join(LEGACY, 'index.html'), 'utf8')
for (const asset of new Set(
  [...html.matchAll(/(?:src|href)="(\/(?:assets\/[^"?#]+|favicon\.ico))"/g)].map((m) => m[1]),
)) {
  const { hops, bytes } = await inspect('https://39page.com' + asset)
  const file = path.join(LEGACY, asset.slice(1))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  snapshot.files.push({
    path: asset,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    status: hops.at(-1).status,
  })
}
for (const endpoint of ['commits/main', 'commits/main/check-runs']) {
  const data = await (
    await fetch('https://api.github.com/repos/Jwavascript/39page/' + endpoint, {
      headers: { 'User-Agent': '39page-release-gate', Accept: 'application/vnd.github+json' },
    })
  ).json()
  snapshot.github[endpoint] =
    endpoint === 'commits/main'
      ? { sha: data.sha, date: data.commit.committer.date }
      : data.check_runs.map((x) => ({
          name: x.name,
          status: x.status,
          conclusion: x.conclusion,
          completed_at: x.completed_at,
          html_url: x.html_url,
        }))
}
snapshot.candidateHeaders = readFileSync('dist/_headers', 'utf8')
snapshot.candidateArtifacts = execFileSync('git', ['status', '--short'], { encoding: 'utf8' })
snapshot.productionSettingsUnverified = [
  'Cloudflare active Worker Version ID',
  'Current dashboard build/deploy commands and production branch',
  'Cloudflare build env vars and Node version',
  'Rollback target Version ID and account access',
]
writeFileSync(path.join(OUT, 'environment-audit.json'), JSON.stringify(snapshot, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      candidate,
      ancestry: snapshot.ancestry,
      mergeSimulation: snapshot.mergeSimulation,
      assets: snapshot.files,
      http: snapshot.http.map((x) => ({ url: x.requested, statuses: x.hops.map((h) => h.status) })),
    },
    null,
    2,
  ),
)
