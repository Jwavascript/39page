// 운영 39page.com 페이지 안에서 **실제 LRCLIB** 에 검색 한 번 (ADR 0046) — 앱이 보내는 것과 같은 머리 · 설정으로.
// 사용자 데이터는 없다(공개 곡 이름 "hachi dune"). 버리는 임시 프로필.
// 실행: POC_CHROME=<chrome.exe> node docs/development/production-release-2026-11-22b-results/check/lrclib-live.mjs
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { launch, waitFor } = await import(
  pathToFileURL(path.resolve('extension/integration/harness.mjs')).href
)

const OUT = path.resolve('docs/development/production-release-2026-11-22b-results')
const results = []
const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const p = await h.tab('https://39page.com/')
  await waitFor(() => p.ev(`!!document.querySelector('.lyrics-widget')`), {
    label: 'app',
    timeout: 30000,
  })
  const probe = await p.ev(`(async () => {
    const response = await fetch('https://lrclib.net/api/search?q=hachi+dune', {
      headers: { 'Lrclib-Client': '39page (https://39page.com)', Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    })
    const body = await response.json()
    const dune = body.find((r) => /dune/i.test(r.trackName) && /hachi/i.test(r.artistName) && typeof r.syncedLyrics === 'string')
    return { origin: location.origin, status: response.status, count: body.length, dune: dune ? { id: dune.id, trackName: dune.trackName, artistName: dune.artistName, duration: dune.duration } : null, widget: !!document.querySelector('.lyrics-widget'), footer: !!document.querySelector('footer') }
  })()`)
  results.push({
    name: '운영 페이지에서 실제 LRCLIB 검색(CORS · Lrclib-Client) — 싱크 가사가 있는 DUNE 레코드',
    pass:
      probe.origin === 'https://39page.com' &&
      probe.status === 200 &&
      probe.dune !== null &&
      probe.widget &&
      !probe.footer,
    details: probe,
  })
} catch (error) {
  results.push({ name: '운영 LRCLIB 확인', pass: false, details: { error: String(error) } })
} finally {
  writeFileSync(
    path.join(OUT, 'lrclib-live.json'),
    `${JSON.stringify({ date: new Date().toISOString(), results }, null, 2)}\n`,
  )
  await h.kill()
}
for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.name, JSON.stringify(r.details))
if (results.some((r) => !r.pass)) process.exitCode = 1
