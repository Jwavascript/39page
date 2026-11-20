// ADR 0042 — 공유 입구(지금 재생 카드 · 데크 아이콘)와 카드의 내 앨범아트를 실제 Chrome 에서 본다.
// 합성 데이터 · 격리된 임시 프로필 · 로컬 빌드만 쓴다. 앨범아트는 페이지 안 캔버스로 만든 합성 그림을 앱의 설정 화면으로 올린다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/share-entry-results/check/share-entry.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve(process.env.OUT ?? 'docs/development/share-entry-results')
mkdirSync(OUT, { recursive: true })

const ids = (prefix, count) =>
  Array.from({ length: count }, (_, i) =>
    `${prefix}${String(i).padStart(10 - prefix.length + 1, '0')}`.slice(0, 11),
  )
const list = (id, name, titles) => ({
  id,
  name,
  tracks: titles.map((title, i) => ({
    id: `${id}${String(i)}`,
    source: 'youtube',
    videoId: id === 'a' && i === 0 ? 'aqz-KE-bpKQ' : ids(`${id}x`, titles.length)[i],
    title,
  })),
})
const lists = [
  list('a', '여름 밤 플레이리스트', [
    '아이유 - 밤편지 (Through the Night) MV',
    '잔나비 - 주저하는 연인들을 위해',
    'Lauv - Paris in the Rain [Official Audio]',
  ]),
  list(
    'b',
    '드라이브 12곡',
    Array.from({ length: 12 }, (_, i) => `드라이브 곡 ${String(i + 1)}`),
  ),
]
const seed = { version: 1, data: { playlists: lists, selectedPlaylistId: 'a' } }

const results = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 300))
}

const h = await launch({
  chrome: process.env.POC_CHROME,
  webDist: path.resolve('dist'),
  headful: false,
})
try {
  const p = await h.tab('about:blank')
  const ev = p.ev
  const send = (method, params = {}) => h.cdp.send(method, params, p.session)
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const size = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768,
    })
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  }
  const click = async (selector) => {
    const point = await ev(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('no ' + ${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    await sleep(300)
  }
  const setTheme = async (key) => {
    await ev(
      `[...document.querySelectorAll('.theme-switch button')].find((b) => b.textContent.toLowerCase().includes(${JSON.stringify(key === 'mono-vinyl' ? 'mono' : 'synth')}))?.click(); true`,
    )
    await waitFor(() => ev(`document.documentElement.dataset.theme === ${JSON.stringify(key)}`), {
      label: key,
    })
    await sleep(300)
  }
  const closeDialog = async () => {
    await ev(`document.querySelector('[aria-label="데이터 닫기"]')?.click(); true`)
    await waitFor(() => ev(`document.querySelector('.data-backdrop')?.hidden === true`), {
      label: 'closed',
    })
    await sleep(200)
  }
  const shareState = () =>
    ev(
      `({ open: document.querySelector('.data-backdrop')?.hidden === false, list: document.querySelector('[aria-label="공유할 목록"]')?.value, range: document.querySelector('[aria-label="공유할 범위"]')?.value })`,
    )
  /** 카드가 다 그려지면 PNG 를 받는다 — 지난 카드가 아니게 `previous` 와 다른 src. */
  const grab = async (name, previous = null) => {
    const info = await waitFor(
      () =>
        ev(`(async () => {
          if (document.querySelector('.card-share .card-preview')?.dataset.state !== 'ready') return null
          const img = document.querySelector('.card-share .card-preview-image')
          if (!img || !img.complete || img.naturalWidth === 0) return null
          if (${JSON.stringify(previous)} !== null && img.src === ${JSON.stringify(previous)}) return null
          const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return { src: img.src, width: img.naturalWidth, height: img.naturalHeight, meta: document.querySelector('.card-share .meta')?.textContent.trim(), b64: btoa(binary) }
        })()`),
      { label: `card ${name}`, timeout: 20_000 },
    )
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(info.b64, 'base64'))
    return info
  }

  await size(1440, 900)
  await send('Page.navigate', { url: BASE })
  await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
  await ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); window.__old = true; true`,
  )
  await send('Page.reload')
  await waitFor(() => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`), {
    label: 'seeded',
  })

  // 1. 재생 전 — 데크 아이콘은 고른 목록, 지금 재생 카드에는 아이콘 · YouTube 링크가 없다.
  record(
    '재생 전: 데크 공유 아이콘 = 고른 목록, 카드에는 공유 · YouTube 링크 없음',
    await ev(`(() => {
    const deck = document.querySelector('.deck-share')
    return deck?.getAttribute('aria-label') === '지금 목록 공유 — 여름 밤 플레이리스트' && !deck.disabled &&
      !document.querySelector('.action-row .share') && !document.querySelector('.action-row a') && !document.querySelector('.youtube-fallback')
  })()`),
  )

  // 2. 재생 — 카드의 YouTube 링크 자리에 공유 아이콘.
  await click('.now-playlist .play-all')
  await waitFor(() => ev(`!!document.querySelector('.action-row .share')`), { label: 'share icon' })
  await sleep(1500)
  const row = await ev(`(() => {
    const share = document.querySelector('.action-row .share').getBoundingClientRect()
    const next = document.querySelector('[aria-label="다음 곡"]').getBoundingClientRect()
    return { share: [share.width, share.height], external: !!document.querySelector('.action-row a'), label: document.querySelector('.action-row .share').getAttribute('aria-label') }
  })()`)
  record(
    '재생 중: 공유 아이콘 44×44, YOUTUBE에서 열기 없음',
    row.share[0] === 44 && row.share[1] === 44 && !row.external && row.label === '이 곡 공유',
    row,
  )
  for (const theme of ['kawaii-synth-cassette', 'mono-vinyl']) {
    await setTheme(theme)
    for (const [w, hgt] of [
      [1440, 900],
      [390, 844],
    ]) {
      await size(w, hgt)
      await sleep(500)
      await ev(`window.scrollTo(0, 0); true`)
      await sleep(200)
      await shot(`dashboard-${theme}-${String(w)}`)
      const fit = await ev(`(() => {
        const deck = document.querySelector('.deck-share').getBoundingClientRect()
        const share = document.querySelector('.action-row .share').getBoundingClientRect()
        return { deck: [Math.round(deck.x), Math.round(deck.right), Math.round(deck.width)], share: [Math.round(share.x), Math.round(share.right)], viewport: innerWidth, scroll: document.documentElement.scrollWidth }
      })()`)
      record(
        `${theme} ${String(w)}px: 두 아이콘이 화면 안, 가로 넘침 없음`,
        fit.deck[0] >= 0 && fit.deck[1] <= w && fit.share[1] <= w && fit.scroll <= w,
        fit,
      )
    }
    await size(1440, 900)
  }
  await setTheme('kawaii-synth-cassette')

  // 3. 카드 아이콘 → 지금 곡을 대화상자로.
  await click('.action-row .share')
  await waitFor(async () => (await shareState()).open, { label: 'dialog' })
  const trackTarget = await shareState()
  record(
    '지금 재생 공유 → 대화상자: 지금 목록 · 지금 곡',
    trackTarget.list === 'a' && trackTarget.range === 'a0',
    trackTarget,
  )
  await closeDialog()

  // 4. 데크 아이콘 → 목록 전체.
  await click('.deck-share')
  await waitFor(async () => (await shareState()).open, { label: 'dialog' })
  const listTarget = await shareState()
  record(
    '데크 공유 → 대화상자: 지금 목록 전체',
    listTarget.list === 'a' && listTarget.range === '',
    listTarget,
  )
  const plain = await grab('card-jcard-plain')
  record(
    '그림 없는 목록: 체크 칸 없음, 기본 그림',
    plain.meta === '카세트 J카드 · 1080×1350 PNG' &&
      !(await ev(
        `[...document.querySelectorAll('.card-share label')].some((l) => l.textContent.includes('앨범아트'))`,
      )),
    { meta: plain.meta },
  )
  await closeDialog()

  // 5. 오류 때만 YouTube 링크 — 재생 오류를 흉내 내지 않는다(실제 YouTube 영상). 링크가 평소에 없는 것만 본다.
  record(
    '평소(재생 중)에는 YouTube 링크가 없다',
    !(await ev(`!!document.querySelector('.youtube-fallback')`)),
  )

  // 6. 합성 앨범아트를 앱의 설정 화면으로 올린다 — 목록 a 의 두 번째 곡, 목록 b(12곡)의 세 번째 곡.
  const uploadArt = async (listName, title, colors) => {
    if (await ev(`document.querySelector('#archive-panel')?.hidden !== false`))
      await click('.app-nav button')
    await sleep(300)
    await ev(
      `[...document.querySelectorAll('.archive-lists .list-select')].find((b) => b.textContent.includes(${JSON.stringify(listName)}))?.click(); true`,
    )
    await sleep(300)
    await ev(
      `(() => { const t = document.querySelector('button.track-manage[aria-label=' + JSON.stringify(${JSON.stringify(title)} + ' 관리') + ']'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); return true })()`,
    )
    await sleep(250)
    await ev(
      `document.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(title)} + ' 앨범아트 설정') + ']').click(); true`,
    )
    await waitFor(() => ev(`!!document.querySelector('.artwork-settings input[type="file"]')`), {
      label: 'settings',
    })
    await ev(`(async () => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 900, 600);
      ${JSON.stringify(colors)}.forEach((color, i, all) => grad.addColorStop(i / (all.length - 1), color))
      g.fillStyle = grad; g.fillRect(0, 0, 900, 600)
      g.fillStyle = 'rgba(20, 20, 40, 0.85)'; g.beginPath(); g.arc(450, 300, 190, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ffffff'; g.font = '700 120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ART', 450, 300)
      g.fillStyle = '#222'; g.fillRect(0, 0, 60, 600); g.fillRect(840, 0, 60, 600)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'synthetic-cover.png', { type: 'image/png' }))
      const input = document.querySelector('.artwork-settings input[type="file"]')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await waitFor(
      () => ev(`document.querySelector('.artwork-settings .pill--primary')?.disabled === false`),
      { label: 'can save', timeout: 10_000 },
    )
    await ev(`document.querySelector('.artwork-settings .pill--primary').click(); true`)
    await waitFor(
      () => ev(`document.querySelector('.artwork-settings')?.textContent.includes('저장했습니다')`),
      { label: 'saved', timeout: 10_000 },
    )
    await ev(`document.querySelector('[aria-label="앨범아트 설정 닫기"]')?.click(); true`)
    await sleep(200)
  }
  await uploadArt('여름 밤 플레이리스트', '잔나비 - 주저하는 연인들을 위해', [
    '#ff7eb3',
    '#7afcff',
    '#feff9c',
  ])
  await uploadArt('드라이브 12곡', '드라이브 곡 3', ['#2b5876', '#4e4376', '#f7b733'])
  record('합성 앨범아트 두 장을 설정 화면으로 저장', true)
  // 보관함에서 고른 목록을 a 로 되돌리고 닫는다 — 큐는 a 그대로다.
  await ev(
    `[...document.querySelectorAll('.archive-lists .list-select')].find((b) => b.textContent.includes('여름 밤'))?.click(); true`,
  )
  await sleep(200)
  await ev(`document.querySelector('[aria-label="보관함 닫기"]:not([hidden])')?.click(); true`)
  await sleep(400)

  // 7. 목록 카드 — 두 테마 · 영수증. 처음 만나는 그림(두 번째 곡)이 들어간다.
  await click('.deck-share')
  await waitFor(async () => (await shareState()).open, { label: 'dialog' })
  let card = await grab('card-jcard-art', plain.src)
  const checkbox = await ev(
    `(() => { const l = [...document.querySelectorAll('.card-share label')].find((x) => x.textContent.includes('내 앨범아트 넣기')); return l ? l.querySelector('input').checked : null })()`,
  )
  record(
    '목록(Kawaii): J카드에 내 앨범아트, 기본 켜짐',
    card.meta === '카세트 J카드 · 앨범아트 · 1080×1350 PNG' && checkbox === true,
    { meta: card.meta, checkbox },
  )
  await setTheme('mono-vinyl')
  card = await grab('card-lp-art', card.src)
  record('목록(Mono): LP 뒷면에 내 앨범아트', card.meta === 'LP 뒷면 · 앨범아트 · 1080×1080 PNG', {
    meta: card.meta,
  })
  await ev(
    `(() => { const l = [...document.querySelectorAll('.card-share label')].find((x) => x.textContent.includes('내 앨범아트 넣기')); l.querySelector('input').click(); return true })()`,
  )
  card = await grab('card-lp-off', card.src)
  record('끄면 기본 그림으로 다시 그린다', card.meta === 'LP 뒷면 · 1080×1080 PNG', {
    meta: card.meta,
  })
  await ev(
    `(() => { const l = [...document.querySelectorAll('.card-share label')].find((x) => x.textContent.includes('내 앨범아트 넣기')); l.querySelector('input').click(); return true })()`,
  )
  card = await grab('card-lp-on-again', card.src)
  await closeDialog()

  // 8. 곡 카드 — 두 번째 곡을 재생하고 카드의 공유 아이콘으로.
  await click('[aria-label="다음 곡"]')
  await sleep(800)
  await click('.action-row .share')
  await waitFor(async () => (await shareState()).open, { label: 'dialog' })
  const second = await shareState()
  card = await grab('card-mono-single-art', card.src)
  record(
    '곡(Mono): 지금 곡(두 번째) · 싱글에 그 곡의 그림',
    second.range === 'a1' && card.meta === '싱글 · 앨범아트 · 1080×1080 PNG',
    { second, meta: card.meta },
  )
  await setTheme('kawaii-synth-cassette')
  card = await grab('card-kawaii-single-art', card.src)
  record('곡(Kawaii): 싱글에 그 곡의 그림', card.meta === '싱글 · 앨범아트 · 1080×1350 PNG', {
    meta: card.meta,
  })
  await closeDialog()

  // 9. 영수증 — 12곡 목록으로 바꿔(재생 중이면 바로 재생) 데크 아이콘으로. 세 번째 곡의 그림이 맨 위에.
  await ev(`document.querySelector('.now-playlist .switch-list')?.click(); true`)
  await sleep(200)
  await ev(
    `[...document.querySelectorAll('.now-playlist .picker-row')].find((b) => b.textContent.includes('드라이브 12곡'))?.click(); true`,
  )
  await sleep(1200)
  record(
    '목록 바꾸기 뒤 데크 아이콘은 그 목록',
    (await ev(`document.querySelector('.deck-share').getAttribute('aria-label')`)) ===
      '지금 목록 공유 — 드라이브 12곡',
  )
  // 12곡 목록은 합성 영상 ID 라 실제 YouTube 가 재생을 거절한다(오류 150 등) — 그 안내 아래에 YouTube 링크가 선다.
  const fallback = await waitFor(
    () =>
      ev(`(() => {
        const status = document.querySelector('.now-playing-card .status')?.textContent.trim() ?? ''
        const link = document.querySelector('.youtube-fallback')
        if (!status.includes('오류') || link === null) return null
        return { status, href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel'), playerState: document.querySelector('.now-sub')?.textContent.trim() }
      })()`),
    { label: 'player error link', timeout: 20_000 },
  )
  record(
    '실제 YouTube 재생 오류 → 안내 아래 YouTube 링크 (새 창 · opener 없음)',
    fallback.href === `https://www.youtube.com/watch?v=${lists[1].tracks[0].videoId}` &&
      fallback.target === '_blank' &&
      fallback.rel === 'noopener noreferrer',
    fallback,
  )
  await click('.deck-share')
  await waitFor(async () => (await shareState()).open, { label: 'dialog' })
  card = await grab('card-receipt-art', card.src)
  record(
    '12곡 목록: 영수증 맨 위에 그 목록의 그림',
    card.meta.startsWith('영수증 · 앨범아트 · 1080×'),
    { meta: card.meta, height: card.height },
  )
  await setTheme('mono-vinyl')
  card = await grab('card-receipt-art-mono', card.src)
  record('12곡 목록(Mono): 영수증 · 앨범아트', card.meta.startsWith('영수증 · 앨범아트 · 1080×'), {
    meta: card.meta,
  })
  await setTheme('kawaii-synth-cassette')
  await closeDialog()

  // 10. 보관함을 연 띠 배치 — 공유 아이콘이 조작 줄 끝에 남는다.
  await size(1440, 900)
  await click('.app-nav button')
  await sleep(500)
  await shot('archive-strip-1440')
} finally {
  h.cdp.close()
  h.kill()
  await sleep(1000)
}

writeFileSync(
  path.join(OUT, 'real-chrome-share-entry.json'),
  `${JSON.stringify({ observedAt: new Date().toISOString(), base: BASE, results }, null, 2)}\n`,
)
const failed = results.filter((r) => !r.pass)
console.log(`${String(results.length - failed.length)}/${String(results.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
