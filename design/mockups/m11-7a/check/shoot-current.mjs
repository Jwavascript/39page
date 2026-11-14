// M11-7A — 지금(M11-6) 웹앱의 기준 화면을 격리 프로필 · 샘플 데이터로 찍는다. 외부 요청(YouTube · 날씨)은 막는다.
//   POC_CHROME=<cft chrome> WEB_DIST=<dist> OUT=<dir> REPO_INT=<extension/integration> node shoot-current.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
mkdirSync(OUT, { recursive: true })

const now = '2026-11-14T03:00:00.000Z'
const vids = ['dQw4w9WgXcQ', 'M7lc1UVf-VE', 'aqz-KE-bpKQ', 'jNQXAC9IVRw', 'kJQP7kiw5Fk', '9bZkp7q19f0', 'OPf0YbXqDm0', 'fJ9rUzIMcZQ', 'hTWKbfoikeg', 'YQHsXMglC9A', 'L_jWHffIx5E']
const names = ['MY RECORDS', '새벽 드라이브', '작업할 때', '비 오는 날 — 창가에서 듣는 아주 긴 이름의 플레이리스트', 'City Pop', '운동', 'Lo-fi', '재즈 피아노', '2000s', '여행', '잠들기 전']
const titles = ['Never Gonna Give You Up', 'YouTube Developers Live: Embedded Web Player Customization', 'Big Buck Bunny 60fps 4K — Official Blender Foundation Short Film', 'Me at the zoo', 'Luis Fonsi - Despacito ft. Daddy Yankee', 'PSY - GANGNAM STYLE(강남스타일) M/V', 'Uptown Funk', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 'Nirvana - Smells Like Teen Spirit', 'Adele - Hello', 'Linkin Park - Numb']
let n = 0
const playlists = names.map((name, i) => ({
  id: `p${i}`,
  name,
  tracks: Array.from({ length: i === 0 ? 6 : i === 1 ? 4 : 1 + (i % 2) }, (_, k) => {
    n += 1
    const v = (i + k) % vids.length
    return { id: `t${n}`, source: 'youtube', videoId: vids[v], title: titles[v] }
  }),
}))
const moments = [
  [0, 43, '후렴 직전 — 베이스가 들어오는 곳'], [0, 112, '브릿지'], [0, 151, ''], [0, 30, '인트로 끝'], [0, 200, '마지막 후렴'],
  [1, 12, ''], [2, 65, '토끼 등장'], [3, 5, '첫 마디'], [4, 80, '드랍'], [5, 70, '말춤'], [7, 180, '기타 솔로'],
].map(([v, at, note], i) => ({ id: `m${i}`, source: 'youtube', videoId: vids[v], atSeconds: at, note, title: titles[v], createdAt: now, updatedAt: now }))
const seed = {
  '39page.library': JSON.stringify({ version: 1, data: { playlists, selectedPlaylistId: 'p0' } }),
  '39page.moments': JSON.stringify({ version: 1, data: moments }),
}

const h = await launch({ chrome: process.env.POC_CHROME, webDist: process.env.WEB_DIST, headful: false })
const shots = []
try {
  const page = await h.tab('about:blank')
  await h.cdp.send('Network.enable', {}, page.session)
  await h.cdp.send('Network.setBlockedURLs', { urls: ['*youtube*', '*ytimg*', '*googlevideo*', '*open-meteo*', '*doubleclick*', '*google*'] }, page.session)
  const size = (width, height, mobile = false) =>
    h.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, page.session)
  const go = async (theme = 'mono-vinyl') => {
    await h.cdp.send('Page.navigate', { url: BASE + '/' }, page.session)
    await sleep(800)
    await page.ev(`(() => { localStorage.clear(); const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, s[k]); localStorage.setItem('39page.theme', JSON.stringify({ version: 1, data: '${theme}' })); return true })()`)
    await h.cdp.send('Page.reload', {}, page.session)
    await waitFor(() => page.ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
    await sleep(1200)
  }
  const shot = async (name, full = false) => {
    const r = await h.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }, page.session)
    const file = path.join(OUT, `${name}.png`)
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    shots.push(file)
  }
  const click = (selector) => page.ev(`(() => { const el = [...document.querySelectorAll('button, [role=button]')].find((b) => b.matches(${JSON.stringify(selector)}) || b.textContent.includes(${JSON.stringify(selector)})); if (!el) return false; el.click(); return true })()`)

  for (const theme of ['mono-vinyl', 'kawaii-synth-cassette']) {
    const t = theme === 'mono-vinyl' ? 'mono' : 'kawaii'
    await size(1321, 761)
    await go(theme)
    await shot(`now-${t}-1321-dashboard`)
    await shot(`now-${t}-1321-dashboard-full`, true)
    await click('음악')
    await sleep(700)
    await shot(`now-${t}-1321-archive-music`)
    await click('Moments')
    await sleep(700)
    await shot(`now-${t}-1321-archive-moments`)
  }
  await size(390, 844, true)
  await go('mono-vinyl')
  await shot('now-mono-390-dashboard-full', true)
  await shot('now-mono-390-dashboard')
  await click('음악')
  await sleep(900)
  await shot('now-mono-390-archive-music')

  // 진입점 세기 — 지금 화면에서 보관함 · Moments 로 가는 단추 이름
  await size(1321, 761)
  await go('mono-vinyl')
  const entries = await page.ev(`[...document.querySelectorAll('button, a')].filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\\s+/g, ' ')).filter(Boolean)`)
  writeFileSync(path.join(OUT, 'buttons-dashboard.json'), JSON.stringify(entries, null, 2))
  console.log(JSON.stringify({ shots: shots.length, buttons: entries.length }))
} finally {
  h.cdp.close()
  h.kill()
}
