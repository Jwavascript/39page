// M12-4 — 전체 백업(ZIP) · 공유 파일을 **다른 브라우저 프로필**로 옮긴다. 실제 Chrome · 실제 IndexedDB · 실제 디코딩.
// 프로필 A: 곡 · Moments · 앨범아트(PNG · GIF) → 전체 백업 ZIP · 공유 파일 · 변조한 ZIP 을 만든다.
// 프로필 B(새 임시 프로필): ZIP 복원 → 목록 · 순서 · Moments · 그림 · 연결 확인, 변조 ZIP 거절.
// 프로필 C(새 임시 프로필): 공유 파일 가져오기 → 새 목록 · 그림.
//   POC_CHROME=<chrome> WEB_DIST=<dist> OUT=<dir> IMG=<dir> REPO_INT=<extension/integration> node transfer.mjs
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

async function session(run) {
  const h = await launch({
    chrome: process.env.POC_CHROME,
    webDist: process.env.WEB_DIST,
    headful: false,
  })
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
    const click = async (sel) => {
      const p = await ev(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
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
    const clickText = async (selector, text) => {
      const ok = await ev(
        `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.setAttribute('data-hit', '1'); return true })()`,
      )
      if (!ok) throw new Error('no button ' + text)
      await click('[data-hit="1"]')
      await ev(`document.querySelector('[data-hit="1"]')?.removeAttribute('data-hit'); true`)
    }
    const setFile = async (selector, file) => {
      const { root } = await send('DOM.getDocument', { depth: -1 })
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
      await send('DOM.setFileInputFiles', { nodeId, files: [file] })
    }
    // 내려받기 가로채기 — 앵커 클릭을 막고 blob URL 의 바이트를 base64 로 남긴다.
    const armDownload = () =>
      ev(
        `(() => { window.__dl = null; if (!window.__dlPatched) { window.__dlPatched = true; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { const name = this.download; fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); window.__dl = { name, b64: btoa(s) } }); return } return click.call(this) } } return true })()`,
      )
    const takeDownload = async () => {
      await waitFor(() => ev(`!!window.__dl`), { label: 'download' })
      const dl = await ev(`window.__dl`)
      return { name: dl.name, bytes: Buffer.from(dl.b64, 'base64') }
    }
    const idb = () =>
      ev(
        `new Promise((r) => { const q = indexedDB.open('39page-artwork'); q.onsuccess = () => { const t = q.result.transaction(['assets','assignments']); const a = t.objectStore('assets').getAll(); const s = t.objectStore('assignments').getAll(); t.oncomplete = () => r({ assets: a.result.map((x) => [x.mimeType, x.width]).sort(), links: s.result.map((x) => x.mode).sort() }) } })`,
      )
    const card = () =>
      ev(
        `(() => { const box = document.querySelector('.now-playing-card [data-artwork-source]'); const img = box?.querySelector('.artwork-image__custom'); return { source: box?.dataset.artworkSource, natural: img ? [img.naturalWidth, img.naturalHeight] : null, title: document.querySelector('.now-playing-card .now-title')?.textContent.trim() } })()`,
      )
    const library = () =>
      ev(
        `JSON.parse(localStorage.getItem('39page.library')).data.playlists.map((p) => [p.name, p.tracks.map((t) => t.title)])`,
      )
    await send('Page.navigate', { url: BASE + '/' })
    await waitFor(() => ev(`!!document.querySelector('[data-widget="player"]')`), { label: 'app' })
    await run({
      send,
      ev,
      click,
      clickText,
      setFile,
      armDownload,
      takeDownload,
      idb,
      card,
      library,
      page,
      h,
    })
  } finally {
    h.cdp.close()
    h.kill()
    await sleep(2500) // 미리보기 서버 포트가 풀리기를 기다린다
  }
}

const reloadApp = async (t) => {
  await t.ev(`window.__old = true; true`)
  await t.send('Page.reload', {})
  await waitFor(() => t.ev(`!window.__old && !!document.querySelector('.now-playlist')`), {
    label: 'reload',
  })
}

/* ---------------- 프로필 A ---------------- */
let fullZip = null
let shareZip = null
await session(async (t) => {
  const lib = {
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
  const now = new Date().toISOString()
  const moments = {
    version: 1,
    data: [
      {
        id: 'm1',
        source: 'youtube',
        videoId: 'aqz-KE-bpKQ',
        atSeconds: 12,
        note: 'carrot',
        title: 'Bunny A',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'm2',
        source: 'youtube',
        videoId: 'eRsGyueVLvQ',
        atSeconds: 30,
        note: 'dragon',
        title: 'Sintel A',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
  await t.ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(lib))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); true`,
  )
  await reloadApp(t)

  // 그림: Bunny A ← PNG, Bunny B ← GIF, Sintel A ← 기본.
  const setArtwork = async (title, listName, file, mode) => {
    const open = await t.ev(`!document.getElementById('archive-panel').hidden`)
    if (!open) await t.click('.app-nav button')
    await t.clickText('#archive-panel .music-lists button', listName)
    await t.ev(
      `(() => { const b = document.querySelector('button.track-manage[aria-label="${title} 관리"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true })()`,
    )
    await sleep(300)
    await t.click(`button[aria-label="${title} 앨범아트 설정"]`)
    await waitFor(() => t.ev(`!!document.querySelector('.artwork-settings')`), {
      label: 'settings',
    })
    if (file !== null) {
      await t.setFile('.artwork-settings input[type="file"]', path.join(IMG, file))
      await waitFor(
        () => t.ev(`document.querySelectorAll('.artwork-settings .preview').length === 2`),
        { label: 'preview' },
      )
    } else {
      await t.ev(`document.querySelector('.artwork-settings input[value="${mode}"]').click(); true`)
    }
    await t.click('.artwork-settings .pill--primary')
    await waitFor(
      () =>
        t.ev(
          `document.querySelector('.artwork-settings .settings-status')?.textContent.includes('저장했습니다')`,
        ),
      { label: 'saved' },
    )
    await t.ev(
      `document.querySelector('.artwork-settings [aria-label="앨범아트 설정 닫기"]').click(); true`,
    )
    await sleep(300)
  }
  await setArtwork('Bunny A', 'LIST A', 'cover-a.png')
  await setArtwork('Sintel A', 'LIST A', null, 'default')
  await setArtwork('Bunny B', 'LIST B', 'dance.gif')
  const dbA = await t.idb()
  record(
    'A: 그림 셋 저장 (PNG · 기본 · GIF)',
    dbA.assets.length === 2 && dbA.links.length === 3,
    dbA,
  )

  // 데이터 · 백업 → 전체 백업
  await t.ev(`document.querySelector('.strip-close:not([hidden])')?.click(); true`)
  await t.clickText('.app-nav button', '데이터')
  await t.armDownload()
  const started = Date.now()
  await t.clickText('.backup .pill', '전체 백업 (ZIP)')
  fullZip = await t.takeDownload()
  const ms = Date.now() - started
  writeFileSync(path.join(OUT, 'full.zip'), fullZip.bytes)
  const notice = await t.ev(`document.querySelector('.full-result')?.textContent.trim()`)
  record(
    'A: 전체 백업 ZIP 만들기',
    fullZip.name.endsWith('.zip') && notice.includes('이미지 2개') && !notice.includes('완료되지'),
    { name: fullZip.name, bytes: fullZip.bytes.length, ms, notice },
  )

  // 공유: LIST A 전체, Moments 넣기
  await t.ev(
    `(() => { const s = document.querySelector('select[aria-label="공유할 목록"]'); s.value = 'pa'; s.dispatchEvent(new Event('change')); const c = [...document.querySelectorAll('.share .check input[type="checkbox"]')][0]; if (!c.checked) c.click(); return true })()`,
  )
  await sleep(300)
  await t.armDownload()
  await t.clickText('.share .pill', '공유 파일 만들기')
  shareZip = await t.takeDownload()
  writeFileSync(path.join(OUT, 'share.zip'), shareZip.bytes)
  record('A: 공유 파일 만들기 (LIST A + Moments)', shareZip.name === 'LIST A.39page-share.zip', {
    name: shareZip.name,
    bytes: shareZip.bytes.length,
  })

  // 변조 ZIP — 저장된 PNG 안 한 바이트를 바꾼다.
  const tampered = Buffer.from(fullZip.bytes)
  const at = tampered.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  tampered[at + 30] ^= 0xff
  writeFileSync(path.join(OUT, 'tampered.zip'), tampered)
})

/* ---------------- 프로필 B — 복원 ---------------- */
await session(async (t) => {
  await t.clickText('.app-nav button', '데이터')
  const input = 'input[aria-label="백업 파일 선택 (ZIP 또는 JSON)"]'
  await t.setFile(input, path.join(OUT, 'tampered.zip'))
  await waitFor(
    () => t.ev(`!document.querySelector('.backup')?.textContent.includes('파일 확인하는 중')`),
    { label: 'check' },
  )
  await sleep(500)
  const tamperMsg = await t.ev(
    `document.querySelector('.backup .backup-result.is-failed')?.textContent.trim() ?? null`,
  )
  record(
    'B: 변조한 ZIP 은 받지 않는다 (아무것도 쓰지 않음)',
    /manifest|손상/.test(tamperMsg ?? '') && (await t.idb()).assets.length === 0,
    { tamperMsg },
  )

  const started = Date.now()
  await t.setFile(input, path.join(OUT, 'full.zip'))
  await waitFor(() => t.ev(`!!document.querySelector('.backup .preview')`), {
    timeout: 30_000,
    label: 'preview',
  })
  const preview = await t.ev(
    `[...document.querySelectorAll('.backup .preview-table tr')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`,
  )
  await t.clickText('.backup .preview .pill', '교체하고 가져오기')
  await waitFor(() => t.ev(`!!document.querySelector('.backup .artwork-result')`), {
    timeout: 30_000,
    label: 'artwork result',
  })
  const ms = Date.now() - started
  const res = await t.ev(
    `[...document.querySelectorAll('.backup .result-list li, .backup .artwork-result')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`,
  )
  const db = await t.idb()
  const lib = await t.library()
  const moments = await t.ev(
    `JSON.parse(localStorage.getItem('39page.moments')).data.map((m) => m.note).sort()`,
  )
  record(
    'B: 전체 백업 복원 — 목록 · 순서 · Moments · 그림 · 연결',
    JSON.stringify(lib) ===
      JSON.stringify([
        ['LIST A', ['Bunny A', 'Sintel A']],
        ['LIST B', ['Bunny B']],
      ]) &&
      JSON.stringify(moments) === JSON.stringify(['carrot', 'dragon']) &&
      db.assets.length === 2 &&
      db.links.length === 3 &&
      res.some((x) => x.includes('앨범아트') && x.includes('저장됨')),
    { preview, res, db, lib, moments, ms },
  )

  await t.ev(`document.querySelector('[aria-label="데이터 닫기"]').click(); true`)
  await sleep(300)
  await reloadApp(t)
  await t.click('.now-playlist .track-row')
  await waitFor(async () => (await t.card()).source === 'custom', {
    timeout: 20_000,
    label: 'custom',
  })
  const a = await t.card()
  // 프로필 A 에서 마지막으로 고른 목록(LIST B)도 백업에 들어 있다 — NOW PLAYLIST 는 LIST B, 첫 곡은 GIF(8px).
  const selected = await t.ev(
    `JSON.parse(localStorage.getItem('39page.library')).data.selectedPlaylistId`,
  )
  record(
    'B: 새로고침 뒤 재생 — 복원된 선택 목록(LIST B)의 첫 곡 그림(GIF 8px)',
    selected === 'pb' && a.natural?.[0] === 8 && a.title === 'Bunny B',
    { ...a, selected },
  )
  const shot = await t.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(OUT, 'profile-b-restored.png'), Buffer.from(shot.data, 'base64'))
})

/* ---------------- 프로필 C — 공유 가져오기 ---------------- */
await session(async (t) => {
  await t.clickText('.app-nav button', '데이터')
  await t.setFile('input[aria-label="공유 파일 선택"]', path.join(OUT, 'share.zip'))
  await waitFor(() => t.ev(`!!document.querySelector('.share-preview')`), {
    timeout: 30_000,
    label: 'share preview',
  })
  const preview = await t.ev(
    `document.querySelector('.share-preview').textContent.replace(/\\s+/g, ' ').trim().slice(0, 160)`,
  )
  await t.ev(
    `(() => { const c = [...document.querySelectorAll('.share-preview .check input[type="checkbox"]')][0]; if (c && !c.checked) c.click(); return true })()`,
  )
  await sleep(200)
  await t.clickText('.share-preview .pill', '가져오기')
  await waitFor(() => t.ev(`!!document.querySelector('.share-results')`), {
    timeout: 30_000,
    label: 'share results',
  })
  const res = await t.ev(
    `[...document.querySelectorAll('.share-results li')].map((x) => x.textContent.trim())`,
  )
  const lib = await t.library()
  const db = await t.idb()
  const moments = await t.ev(
    `JSON.parse(localStorage.getItem('39page.moments') ?? '{"data":[]}').data.map((m) => m.note).sort()`,
  )
  record(
    'C: 공유 가져오기 — 새 목록 · 그림 연결 · 켠 Moments 만 · LIST B 없음',
    lib.some(([name, titles]) => name === 'LIST A' && titles.join() === 'Bunny A,Sintel A') &&
      !lib.some(([name]) => name === 'LIST B') &&
      db.assets.length === 1 &&
      db.links.length === 2 &&
      JSON.stringify(moments) === JSON.stringify(['carrot', 'dragon']),
    { preview, res, lib, db, moments },
  )
})

writeFileSync(path.join(OUT, 'transfer.json'), JSON.stringify({ results }, null, 2))
console.log(`${String(results.filter((r) => r.pass).length)}/${String(results.length)} PASS`)
