// M12-3 — 곡별 앨범아트 올리기. 실제 Chrome · 실제 YouTube · 실제 IndexedDB · 실제 디코딩, 격리 임시 프로필, 로컬 빌드.
//   python make-images.py <IMG>
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> IMG=<dir> REPO_INT=<extension/integration> node artwork.mjs
// 확인: PNG 저장 → 카드 반영 · GIF(포스터) · 교체 · 거절(가짜 PNG · 손상) · 새로고침 뒤 유지 · 같은 영상 두 목록 다른 그림 ·
// 테마 전환 유지 · 이 모든 동안 같은 iframe 이 계속 재생.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const OUT = process.env.OUT
const IMG = process.env.IMG
mkdirSync(OUT, { recursive: true })

const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: process.env.WEB_DIST,
  headful: false,
})
const results = []
const step = async (name, run) => {
  try {
    const details = (await run()) ?? {}
    const pass = details.pass !== false
    results.push({ name, pass, details })
    console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 400))
  } catch (error) {
    results.push({ name, pass: false, error: String(error) })
    console.log('FAIL', name, String(error))
  }
}
try {
  const page = await h.tab('about:blank')
  const send = (m, p) => h.cdp.send(m, p, page.session)
  const ev = (e) => page.ev(e)
  await send('Network.enable', {})
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await send('DOM.enable', {})
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const video = async () => {
    const t = (await h.cdp.targets()).find(
      (x) => x.type === 'iframe' && x.url.includes('youtube.com/embed'),
    )
    if (!t) return null
    const s = await h.cdp.attach(t.targetId)
    try {
      const r = await h.cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused } : null })()`,
          returnByValue: true,
        },
        s,
      )
      return r.result.value
    } finally {
      await h.cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {})
    }
  }
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
    await sleep(400)
  }
  const setFile = async (name) => {
    const { root } = await send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.artwork-settings input[type="file"]',
    })
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(IMG, name)] })
    await waitFor(
      () => ev(`!document.querySelector('.artwork-settings')?.textContent.includes('확인하는 중')`),
      { label: 'validate' },
    )
    await sleep(300)
  }
  const statusText = () =>
    ev(`document.querySelector('.artwork-settings .settings-status')?.textContent.trim() ?? null`)
  const save = async () => {
    await click('.artwork-settings .pill--primary')
    await waitFor(
      () => ev(`!document.querySelector('.artwork-settings')?.textContent.includes('저장하는 중')`),
      { label: 'save' },
    )
    await sleep(400)
  }
  const card = () =>
    ev(
      `(() => { const box = document.querySelector('.now-playing-card [data-artwork-source]'); const img = box?.querySelector('.artwork-image__custom'); return { source: box?.dataset.artworkSource, src: img?.getAttribute('src') ?? null, natural: img ? [img.naturalWidth, img.naturalHeight] : null, motion: !!document.querySelector('.np-art-motion'), title: document.querySelector('.now-playing-card .now-title')?.textContent.trim() } })()`,
    )
  const openSettings = async (title, listIndex = 0) => {
    const open = await ev(`!document.getElementById('archive-panel').hidden`)
    if (!open) await click('.app-nav button')
    await ev(
      `[...document.querySelectorAll('.archive-playlist-row, .playlist-row, [data-playlist-id]')].length; true`,
    )
    if (listIndex > 0) {
      await ev(
        `(() => { const rows = [...document.querySelectorAll('#archive-panel .music-lists button')].filter((b) => b.textContent.includes('LIST B')); rows[0]?.click(); return rows.length })()`,
      )
      await sleep(400)
    }
    await ev(
      `(() => { const b = document.querySelector('button.track-manage[aria-label="${title} 관리"]'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); return !!b })()`,
    )
    await sleep(300)
    await click(`button[aria-label="${title} 앨범아트 설정"]`)
    await waitFor(() => ev(`!!document.querySelector('.artwork-settings')`), { label: 'settings' })
  }
  const closeSettings = async () => {
    await ev(
      `document.querySelector('.artwork-settings [aria-label="앨범아트 설정 닫기"]')?.click(); true`,
    )
    await sleep(300)
  }

  await send('Page.navigate', { url: BASE + '/' })
  await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
  const library = {
    version: 1,
    data: {
      playlists: [
        {
          id: 'pa',
          name: 'LIST A',
          tracks: [
            { id: 'ta1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Bunny A' },
            { id: 'ta2', source: 'youtube', videoId: 'eRsGyueVLvQ', title: 'Sintel A' },
          ],
        },
        {
          id: 'pb',
          name: 'LIST B',
          tracks: [{ id: 'tb1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Bunny B' }],
        },
      ],
      selectedPlaylistId: 'pa',
    },
  }
  await ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(library))}); true`,
  )
  await send('Page.reload', {})
  await waitFor(() => ev(`!!document.querySelector('.now-playlist .track-row')`), {
    label: 'reload',
  })
  await click('.now-playlist .track-row')
  await waitFor(async () => (await video())?.paused === false, {
    timeout: 30_000,
    label: 'playing',
  })
  const marker = await ev(
    `(() => { const f = document.querySelector('.player-mount iframe'); f.__m12 = Math.random(); return f.__m12 })()`,
  )
  const sameIframe = async () =>
    (await ev(`document.querySelector('.player-mount iframe').__m12`)) === marker

  await step('썸네일 (auto) — 저장 전', async () => {
    await waitFor(async () => (await card()).source === 'thumbnail', {
      timeout: 15_000,
      label: 'thumb',
    })
    return { card: await card() }
  })

  await step('가짜 PNG(HTML) 거절 · 손상 PNG 거절 — 아무것도 저장하지 않음', async () => {
    await openSettings('Bunny A')
    await setFile('fake.png')
    const fake = await statusText()
    await setFile('broken.png')
    const broken = await statusText()
    const db = await ev(
      `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const t = q.result.transaction('assets'); const c = t.objectStore('assets').count(); c.onsuccess = () => r(c.result) } })`,
    )
    return {
      pass: fake.includes('PNG · JPEG · WebP · GIF') && broken.includes('손상') && db === 0,
      fake,
      broken,
      assets: db,
    }
  })

  await step('PNG 저장 → 카드가 바뀜 (실제 디코딩 96×96) · 재생 유지', async () => {
    const v1 = await video()
    await setFile('cover-a.png')
    const preview = await ev(
      `document.querySelector('.artwork-settings').textContent.includes('96×96')`,
    )
    await save()
    const msg = await statusText()
    await waitFor(async () => (await card()).source === 'custom', { label: 'custom' })
    await sleep(300)
    const c = await card()
    const v2 = await video()
    return {
      pass:
        preview &&
        msg === '저장했습니다.' &&
        c.natural?.[0] === 96 &&
        (await sameIframe()) &&
        !v2.paused &&
        v2.t > v1.t,
      msg,
      c,
      v1,
      v2,
    }
  })

  await step('교체(PNG → 다른 PNG) — 이전 자산이 지워지고 카드가 바뀜', async () => {
    const before = (await card()).src
    await setFile('cover-b.png')
    await save()
    await waitFor(async () => (await card()).natural?.[0] === 64, { label: 'replaced' })
    const count = await ev(
      `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const c = q.result.transaction('assets').objectStore('assets').count(); c.onsuccess = () => r(c.result) } })`,
    )
    const after = (await card()).src
    return { pass: count === 1 && after !== before, assets: count }
  })

  await step(
    '같은 영상 · 다른 목록(LIST B)의 트랙에 GIF — 포스터 생성, LIST A 그림은 그대로',
    async () => {
      await closeSettings()
      await openSettings('Bunny B', 1)
      await setFile('dance.gif')
      const info = await ev(
        `document.querySelector('.artwork-settings').textContent.includes('GIF (움직임)')`,
      )
      await save()
      const msg = await statusText()
      const rec = await ev(
        `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const t = q.result.transaction(['assets','blobs','assignments']); const a = t.objectStore('assets').getAll(); const b = t.objectStore('blobs').getAll(); const s = t.objectStore('assignments').getAll(); t.oncomplete = () => r({ assets: a.result.map((x) => [x.mimeType, x.animated, x.width]), posters: b.result.map((x) => x.poster ? x.poster.type + ':' + x.poster.size : null), links: s.result.map((x) => [x.playlistId, x.trackId, x.mode]) }) } })`,
      )
      const c = await card() // 지금 곡은 LIST A 의 Bunny A
      return {
        pass:
          info &&
          msg === '저장했습니다.' &&
          rec.assets.length === 2 &&
          rec.posters.some((p) => p?.startsWith('image/png')) &&
          c.natural?.[0] === 64,
        rec,
        c,
      }
    },
  )

  await step('LIST B 의 곡을 재생하면 그 곡의 GIF — 움직임 멈춤 = 포스터', async () => {
    await closeSettings()
    await ev(
      `(() => { const b = document.querySelector('button.track-play[aria-label="Bunny B 재생"]'); b?.click(); return !!b })()`,
    )
    await waitFor(async () => (await card()).title === 'Bunny B', { label: 'bunny b' })
    await waitFor(async () => (await card()).source === 'custom', { label: 'gif custom' })
    const moving = await card()
    await click('.np-art-motion')
    const still = await card()
    await click('.np-art-motion')
    return {
      pass:
        moving.natural?.[0] === 8 &&
        moving.motion &&
        still.src !== moving.src &&
        moving.src.startsWith('blob:'),
      moving,
      still,
    }
  })

  await step('테마 전환 · 새로고침 뒤에도 그림 유지 (IndexedDB)', async () => {
    const before = (await card()).natural
    await ev(
      `[...document.querySelectorAll('.theme-button')].find((b) => b.textContent.includes('MONO')).click(); true`,
    )
    await sleep(400)
    const afterTheme = (await card()).natural
    // 옛 문서를 표시해 두고, 새 문서에서 곡 줄이 그려질 때까지 기다린다 (옛 문서를 보고 넘어가지 않게).
    await ev(`window.__old = true; true`)
    await send('Page.reload', {})
    await waitFor(
      () => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`),
      { label: 'reload2' },
    )
    // 새로고침하면 큐는 사라진다. 보관함에서 LIST B 를 골랐으므로 NOW PLAYLIST 는 LIST B — 그 첫 곡(Bunny B, GIF 8px).
    await click('.now-playlist .track-row')
    let afterReload = null
    await waitFor(async () => (await card()).source === 'custom', {
      timeout: 20_000,
      label: 'after reload',
    }).catch(() => {})
    afterReload = await card()
    afterReload.debug = await ev(
      `({ list: document.querySelector('.now-playlist')?.textContent.slice(0, 80), status: document.querySelector('.now-playing-card .status')?.textContent, mode: document.querySelector('.np-art')?.dataset.artworkMode })`,
    )
    return {
      pass:
        before?.[0] === 8 &&
        afterTheme?.[0] === 8 &&
        afterReload.natural?.[0] === 8 &&
        afterReload.title === 'Bunny B',
      before,
      afterTheme,
      afterReload,
    }
  })

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(OUT, 'artwork-card.png'), Buffer.from(shot.data, 'base64'))
  await openSettings('Bunny B')
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(OUT, 'artwork-settings.png'), Buffer.from(shot2.data, 'base64'))

  writeFileSync(
    path.join(OUT, 'artwork.json'),
    JSON.stringify({ browser: h.cdp.version, results }, null, 2),
  )
  console.log(`${String(results.filter((r) => r.pass).length)}/${String(results.length)} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
