// M12-5 — 통합 검증의 남은 항목. 실제 Chrome · 실제 YouTube · 실제 IndexedDB, 격리 임시 프로필, 로컬 빌드.
//   1. 곡 120개 · 그림 연결 120개(사용자 그림 30 × 약 1 MB) — 저장소 읽기 시간
//   2. Object URL 수명 — 사용자 그림 곡 사이를 30번 오가도 살아 있는 URL 이 늘지 않는다
//   3. 큰 전체 백업 — 약 30 MB ZIP 만들기 시간 · JS 힙 최고치
//   4. 오프라인(썸네일 차단) — 기본 그림
//   5. GIF CPU — 256×256 · 16 프레임 GIF 가 움직일 때와 멈췄을 때(포스터)의 렌더러 작업 시간
//   6. 두 탭 — 같은 곡의 그림을 다른 탭이 먼저 바꾸면 거절 · 다른 탭의 변경이 이 탭에 보인다
//   7. 다른 프로필 — 큰 ZIP 복원 시간 · 결과
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> IMG=<dir> REPO_INT=<extension/integration> node final.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
const IMG = process.env.IMG
mkdirSync(OUT, { recursive: true })
const results = []
const record = (name, pass, details) => {
  results.push({ name, pass, details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 500))
}
const VIDEOS = ['aqz-KE-bpKQ', 'eRsGyueVLvQ', 'R6MlUcmOul8', 'M7lc1UVf-VE']

/** 앱이 그림을 쓰기 전에 Object URL 을 세는 장치를 심는다. */
const URL_COUNTER = `(() => { const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL); window.__urls = { created: 0, revoked: 0, live: new Set() }; URL.createObjectURL = (b) => { const u = c(b); window.__urls.created++; window.__urls.live.add(u); return u }; URL.revokeObjectURL = (u) => { window.__urls.revoked++; window.__urls.live.delete(u); return r(u) } })()`

async function session(run, { counter = false } = {}) {
  const h = await launch({
    chrome: process.env.POC_CHROME,
    webDist: process.env.WEB_DIST,
    headful: false,
  })
  try {
    const open = async () => {
      const page = await h.tab('about:blank')
      const send = (m, p) => h.cdp.send(m, p, page.session)
      const ev = (e, o) => page.ev(e, o)
      await send('Network.enable', {})
      await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
      await send('DOM.enable', {})
      await send('Performance.enable', {})
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      if (counter) await send('Page.addScriptToEvaluateOnNewDocument', { source: URL_COUNTER })
      await send('Page.navigate', { url: BASE + '/' })
      await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), {
        label: 'app',
      })
      const click = async (sel) => {
        const p = await ev(
          `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
        )
        for (const type of ['mousePressed', 'mouseReleased'])
          await send('Input.dispatchMouseEvent', {
            type,
            x: p.x,
            y: p.y,
            button: 'left',
            clickCount: 1,
          })
        await sleep(300)
      }
      const setFiles = async (selector, files) => {
        const { root } = await send('DOM.getDocument', { depth: -1 })
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
        await send('DOM.setFileInputFiles', { nodeId, files })
      }
      const reload = async () => {
        await ev(`window.__old = true; true`)
        await send('Page.reload', {})
        await waitFor(
          () => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`),
          { label: 'reload' },
        )
      }
      const card = () =>
        ev(
          `(() => { const box = document.querySelector('.now-playing-card [data-artwork-source]'); const img = box?.querySelector('.artwork-image__custom'); return { source: box?.dataset.artworkSource, src: img?.getAttribute('src') ?? null, natural: img ? img.naturalWidth : null, title: document.querySelector('.now-playing-card .now-title')?.textContent.trim() } })()`,
        )
      return { page, send, ev, click, setFiles, reload, card }
    }
    await run({ h, open })
  } finally {
    h.cdp.close()
    h.kill()
    await sleep(2500)
  }
}

let bigZip = null

await session(
  async ({ open, h }) => {
    const t = await open()
    // 곡 120 (네 영상을 돌려 쓴다 — 같은 영상의 다른 트랙들).
    const tracks = Array.from({ length: 120 }, (_, i) => ({
      id: `t${String(i).padStart(3, '0')}`,
      source: 'youtube',
      videoId: VIDEOS[i % 4],
      title: `Track ${String(i + 1)}`,
    }))
    const lib = {
      version: 1,
      data: { playlists: [{ id: 'big', name: 'BIG 120', tracks }], selectedPlaylistId: 'big' },
    }
    await t.ev(
      `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(lib))}); true`,
    )

    // 잡음 PNG 30 장을 숨은 입력으로 받아 저장소에 직접 넣는다 (곡 0 ~ 29 사용자 그림, 30 ~ 118 기본, 119 자동).
    await t.ev(
      `(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'bulk'; document.body.append(i); return true })()`,
    )
    await t.setFiles(
      '#bulk',
      Array.from({ length: 30 }, (_, n) =>
        path.join(IMG, `noise-${String(n).padStart(2, '0')}.png`),
      ),
    )
    const injected = await t.ev(
      `(async () => {
    const files = [...document.getElementById('bulk').files]
    const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const db = await new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => r(q.result) })
    const now = new Date().toISOString()
    const records = []
    for (const [n, file] of files.entries()) {
      const buf = await file.arrayBuffer()
      const id = await hex(buf)
      records.push({ id, blob: new Blob([buf], { type: 'image/png' }), track: 't' + String(n).padStart(3, '0'), size: buf.byteLength })
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['assets', 'blobs', 'assignments'], 'readwrite')
      for (const r of records) {
        tx.objectStore('assets').put({ id: r.id, mimeType: 'image/png', byteSize: r.size, width: 580, height: 580, animated: false, createdAt: now })
        tx.objectStore('blobs').put({ id: r.id, blob: r.blob, poster: null })
        tx.objectStore('assignments').put({ playlistId: 'big', trackId: r.track, videoId: '${VIDEOS[0]}', mode: 'custom', assetId: r.id, revision: 1, updatedAt: now })
      }
      for (let i = 30; i < 119; i++) tx.objectStore('assignments').put({ playlistId: 'big', trackId: 't' + String(i).padStart(3, '0'), videoId: '${VIDEOS[0]}', mode: 'default', revision: 1, updatedAt: now })
      tx.oncomplete = resolve; tx.onerror = reject
    })
    db.close()
    return { assets: records.length, bytes: records.reduce((s, r) => s + r.size, 0) }
  })()`,
      { awaitPromise: true, timeout: 120_000 },
    )
    await t.reload()

    // 1. 저장소 읽기 (store 의 reload 와 같은 일 — 연결 · 메타 getAll)
    const read = await t.ev(
      `(async () => { const db = await new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => r(q.result) }); const times = []; for (let k = 0; k < 5; k++) { const t0 = performance.now(); await new Promise((r) => { const tx = db.transaction(['assignments','assets']); tx.objectStore('assignments').getAll(); tx.objectStore('assets').getAll(); tx.oncomplete = r }); times.push(+(performance.now() - t0).toFixed(1)) } const firstKey = await new Promise((rr) => { const g = db.transaction('assets').objectStore('assets').getAllKeys(); g.onsuccess = () => rr(g.result[0]) }); const t0 = performance.now(); await new Promise((r) => { const q = db.transaction('blobs').objectStore('blobs').get(firstKey); q.onsuccess = r }); const blobMs = +(performance.now() - t0).toFixed(1); db.close(); return { times, blobMs } })()`,
      { awaitPromise: true },
    )
    record(
      '1. 곡 120 · 연결 119 · 그림 30(약 30 MB) — 연결 · 메타 읽기 / 그림 한 장 읽기',
      Math.max(...read.times) < 200,
      { injected, ...read },
    )

    // 2. Object URL 수명 — 곡 0 재생 후 다음 곡 29 번(모두 사용자 그림), 다시 30 번째(기본)로.
    // 세는 장치 — 재생 전에는 사용자 그림 URL 이 하나도 없다 (카드가 아직 곡이 없다).
    await t.ev(`(${URL_COUNTER}, window.__urls.created)`)
    await t.click('.now-playlist .track-row')
    await waitFor(async () => (await t.card()).source === 'custom', {
      timeout: 20_000,
      label: 'first custom',
    })
    const switchTimes = []
    for (let i = 1; i < 30; i++) {
      const before = (await t.card()).src
      const t0 = Date.now()
      await t.ev(`document.querySelector('.now-playing-card [aria-label="다음 곡"]').click(); true`)
      await waitFor(
        async () => {
          const c = await t.card()
          return c.source === 'custom' && c.src !== before && c.natural > 0
        },
        { timeout: 15_000, label: 'switch ' + i },
      )
      switchTimes.push(Date.now() - t0)
    }
    await t.ev(`document.querySelector('.now-playing-card [aria-label="다음 곡"]').click(); true`)
    await waitFor(async () => (await t.card()).source === 'default', {
      timeout: 15_000,
      label: 'default',
    })
    await sleep(500)
    const urls = await t.ev(
      `({ created: window.__urls.created, revoked: window.__urls.revoked, live: window.__urls.live.size })`,
    )
    const sorted = [...switchTimes].sort((a, b) => a - b)
    record(
      '2. Object URL — 사용자 그림 곡 30 개를 지나 기본 그림 곡으로: 살아 있는 URL 0',
      urls.live === 0 && urls.created >= 30,
      { urls, switchMedianMs: sorted[14], switchMaxMs: sorted.at(-1) },
    )

    // 3. 큰 전체 백업 — 시간 · 힙 최고치
    await t.ev(
      `(() => { window.__dl = null; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, at: performance.now() }; window.__dlBytes = fetch(this.href).then((r) => r.arrayBuffer()); return } return click.call(this) }; window.__heap = []; window.__heapTimer = setInterval(() => window.__heap.push(performance.memory.usedJSHeapSize), 50); return true })()`,
    )
    const heap0 = await t.ev(`performance.memory.usedJSHeapSize`)
    await t.ev(
      `[...document.querySelectorAll('.app-nav button')].find((b) => b.textContent.includes('데이터')).click(); true`,
    )
    await sleep(300)
    const t0 = await t.ev(`performance.now()`)
    await t.ev(
      `[...document.querySelectorAll('.backup .pill')].find((b) => b.textContent.includes('전체 백업 (ZIP)')).click(); true`,
    )
    await waitFor(() => t.ev(`!!window.__dl`), { timeout: 120_000, label: 'zip' })
    const dl = await t.ev(`window.__dl`)
    await t.ev(`clearInterval(window.__heapTimer); true`)
    const peak = await t.ev(`Math.max(...window.__heap)`)
    const b64 = await t.ev(
      `window.__dlBytes.then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) })`,
      { awaitPromise: true, timeout: 120_000 },
    )
    bigZip = Buffer.from(b64, 'base64')
    writeFileSync(path.join(OUT, 'big.zip'), bigZip)
    const notice = await t.ev(`document.querySelector('.full-result')?.textContent.trim()`)
    record(
      '3. 큰 전체 백업 (그림 30 · 약 30 MB) — 만들기 시간 · JS 힙 최고치',
      notice.includes('이미지 30개') && !notice.includes('완료되지'),
      {
        zipBytes: bigZip.length,
        ms: Math.round(dl.at - t0),
        heapStartMB: +(heap0 / 2 ** 20).toFixed(1),
        heapPeakMB: +(peak / 2 ** 20).toFixed(1),
        notice,
      },
    )
    await t.ev(`document.querySelector('[aria-label="데이터 닫기"]').click(); true`)
    await sleep(300)

    // 4. 오프라인 썸네일 — 곡 120(자동)을 썸네일 차단 상태로
    await t.send('Network.setBlockedURLs', { urls: ['*open-meteo*', '*i.ytimg.com*'] })
    await t.ev(`window.scrollTo(0, 0); true`)
    for (let i = 0; i < 89; i++)
      await t.ev(`document.querySelector('.now-playing-card [aria-label="다음 곡"]').click(); true`)
    await waitFor(async () => (await t.card()).title === 'Track 120', {
      timeout: 30_000,
      label: 'track 120',
    })
    await sleep(1500)
    const offline = await t.card()
    record(
      '4. 썸네일을 받을 수 없을 때(차단 · 오프라인) — 기본 그림',
      offline.source === 'default',
      offline,
    )
    await t.send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })

    // 5. GIF CPU — 곡 120 에 big.gif, 영상 멈춤, 움직임 켬/끔 각 8초
    await t.click('.np-art-edit')
    await waitFor(() => t.ev(`!!document.querySelector('.artwork-settings')`), {
      label: 'settings',
    })
    await t.setFiles('.artwork-settings input[type="file"]', [path.join(IMG, 'big.gif')])
    await waitFor(
      () => t.ev(`document.querySelectorAll('.artwork-settings .preview').length === 2`),
      { timeout: 20_000, label: 'gif preview' },
    )
    await t.click('.artwork-settings .pill--primary')
    await waitFor(
      () =>
        t.ev(
          `document.querySelector('.artwork-settings .settings-status')?.textContent.includes('저장했습니다')`,
        ),
      { label: 'gif saved' },
    )
    await t.ev(
      `document.querySelector('.artwork-settings [aria-label="앨범아트 설정 닫기"]').click(); true`,
    )
    await t.ev(
      `document.querySelector('.strip-close:not([hidden]), #archive-panel .archive-head .close')?.click(); true`,
    )
    await sleep(500)
    await t.ev(`document.querySelector('.now-playing-card [aria-label="일시정지"]')?.click(); true`)
    await sleep(1500)
    const metrics = async () =>
      Object.fromEntries(
        (await t.send('Performance.getMetrics', {})).metrics.map((m) => [m.name, m.value]),
      )
    const sample = async () => {
      const a = await metrics()
      await sleep(8000)
      const b = await metrics()
      return {
        taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
        scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
        layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
      }
    }
    const moving = await sample()
    await t.ev(`document.querySelector('.np-art-motion').click(); true`)
    await sleep(500)
    const still = await sample()
    const gifCard = await t.card()
    record('5. GIF 256×256 · 16 프레임 — 8초 동안 렌더러 작업 시간 (움직임 / 멈춤=포스터)', true, {
      moving,
      still,
      gifCard,
    })

    // 6. 두 탭 — 이 탭이 설정을 연 뒤 다른 탭이 먼저 기본 그림으로 바꾼다
    await t.ev(`document.querySelector('.now-playing-card [aria-label="재생"]')?.click(); true`)
    await t.click('.np-art-edit')
    await waitFor(() => t.ev(`!!document.querySelector('.artwork-settings')`), {
      label: 'settings A',
    })
    await t.ev(`document.querySelector('.artwork-settings input[value="auto"]').click(); true`)
    const other = await open()
    const otherReady = await waitFor(
      () => other.ev(`!!document.querySelector('.now-playlist .track-row')`),
      { label: 'tab2' },
    )
    void otherReady
    await other.ev(`document.querySelector('.app-nav button').click(); true`)
    await sleep(500)
    await other.ev(
      `(() => { const b = document.querySelector('button.track-manage[aria-label="Track 120 관리"]'); b.scrollIntoView(); b.click(); return true })()`,
    )
    await sleep(300)
    await other.ev(
      `document.querySelector('button[aria-label="Track 120 앨범아트 설정"]').click(); true`,
    )
    await waitFor(() => other.ev(`!!document.querySelector('.artwork-settings')`), {
      label: 'settings B',
    })
    await other.ev(
      `document.querySelector('.artwork-settings input[value="default"]').click(); true`,
    )
    await sleep(200)
    await other.ev(`document.querySelector('.artwork-settings .pill--primary').click(); true`)
    await waitFor(
      () =>
        other.ev(
          `document.querySelector('.artwork-settings .settings-status')?.textContent.includes('저장했습니다')`,
        ),
      { label: 'B saved' },
    )
    await sleep(800)
    const seenByA = await t.card()
    await t.ev(`document.querySelector('.artwork-settings .pill--primary').click(); true`)
    await waitFor(
      () =>
        t.ev(`!!document.querySelector('.artwork-settings .settings-status')?.textContent.trim()`),
      { label: 'A result' },
    )
    const aMsg = await t.ev(
      `document.querySelector('.artwork-settings .settings-status').textContent.trim()`,
    )
    const final = await t.ev(
      `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const g = q.result.transaction('assignments').objectStore('assignments').get(['big', 't119']); g.onsuccess = () => r(g.result?.mode ?? 'auto') } })`,
      { awaitPromise: true },
    )
    record(
      '6. 두 탭 — 다른 탭이 먼저 바꾸면 이 탭의 저장은 거절 · 다른 탭의 그림이 이 탭 카드에 보인다',
      aMsg.includes('다른 탭') && final === 'default' && seenByA.source === 'default',
      { aMsg, final, seenByA },
    )
    void h
  },
  { counter: true },
)

// 7. 새 프로필 — 큰 ZIP 복원
await session(async ({ open }) => {
  const t = await open()
  await t.ev(
    `[...document.querySelectorAll('.app-nav button')].find((b) => b.textContent.includes('데이터')).click(); true`,
  )
  await sleep(300)
  const t0 = Date.now()
  await t.setFiles('input[aria-label="백업 파일 선택 (ZIP 또는 JSON)"]', [
    path.join(OUT, 'big.zip'),
  ])
  await waitFor(() => t.ev(`!!document.querySelector('.backup .preview')`), {
    timeout: 180_000,
    label: 'preview',
  })
  const readMs = Date.now() - t0
  const t1 = Date.now()
  await t.ev(
    `[...document.querySelectorAll('.backup .preview .pill')].find((b) => b.textContent.includes('교체하고')).click(); true`,
  )
  await waitFor(() => t.ev(`!!document.querySelector('.backup .artwork-result')`), {
    timeout: 180_000,
    label: 'applied',
  })
  const applyMs = Date.now() - t1
  const res = await t.ev(
    `document.querySelector('.backup .artwork-result').textContent.replace(/\\s+/g, ' ').trim()`,
  )
  const db = await t.ev(
    `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const tx = q.result.transaction(['assets','assignments']); const a = tx.objectStore('assets').count(); const s = tx.objectStore('assignments').count(); tx.oncomplete = () => r({ assets: a.result, links: s.result }) } })`,
    { awaitPromise: true },
  )
  record(
    '7. 새 프로필에 큰 ZIP 복원 — 검증 · 미리보기 시간, 적용 시간, 결과',
    res.includes('저장됨') && db.assets === 30 && db.links === 119,
    { readMs, applyMs, res, db },
  )
})

writeFileSync(path.join(OUT, 'final.json'), JSON.stringify({ results }, null, 2))
console.log(`${String(results.filter((r) => r.pass).length)}/${String(results.length)} PASS`)
