// ADR 0043 — 공유 대화상자 분리 · 데이터 대화상자 단순화 · 카드 정리를 실제 Chrome 에서 본다.
// 합성 데이터 · 격리된 임시 프로필 · 로컬 빌드만 쓴다. 앨범아트는 페이지 안 캔버스로 만든 합성 그림을 앱의 설정 화면으로 올린다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/share-dialog-results/check/share-dialog.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve(process.env.OUT ?? 'docs/development/share-dialog-results')
mkdirSync(OUT, { recursive: true })

const list = (id, name, titles) => ({
  id,
  name,
  tracks: titles.map((title, i) => ({
    id: `${id}${String(i)}`,
    source: 'youtube',
    videoId:
      id === 'a' && i === 0 ? 'aqz-KE-bpKQ' : `${id}x${String(i).padStart(9, '0')}`.slice(0, 11),
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
const at = (id, seconds, note) => ({
  id,
  source: 'youtube',
  videoId: lists[0].tracks[0].videoId,
  atSeconds: seconds,
  note,
  title: lists[0].tracks[0].title,
  createdAt: '2026-11-20T01:00:00.000Z',
  updatedAt: '2026-11-20T01:00:00.000Z',
})
const moments = {
  version: 1,
  data: [
    at('m1', 83, '여기 후렴, 이어폰으로 꼭 들어 봐'),
    at('m2', 12, ''),
    at(
      'm3',
      201,
      '마지막 브릿지에서 숨 들이쉬는 소리까지 들려서 좋아하는 부분. 이 노래를 처음 들었던 겨울 밤 생각이 나요',
    ),
  ],
}

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
  const dialogState = () =>
    ev(`(() => {
      const d = document.querySelector('.share-dialog')
      return {
        share: !!d,
        data: document.querySelector('.data-backdrop')?.hidden === false,
        kind: d?.querySelector('.target-kind')?.textContent.trim() ?? null,
        name: d?.querySelector('.target-name')?.textContent.trim() ?? null,
        detail: d?.querySelector('.target-detail')?.textContent.trim() ?? null,
        options: d ? d.querySelectorAll('input[type="checkbox"], select').length : null,
        text: d?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
      }
    })()`)
  const closeShare = async () => {
    await ev(`document.querySelector('[aria-label="공유 닫기"]')?.click(); true`)
    await waitFor(() => ev(`!document.querySelector('.share-dialog')`), { label: 'share closed' })
    await sleep(200)
  }
  /** 카드가 다 그려지면 PNG 와 data-* 를 받는다. */
  const grab = async (name, previous = null) => {
    const info = await waitFor(
      () =>
        ev(`(async () => {
          const box = document.querySelector('.card-share .card-preview')
          if (box?.dataset.state !== 'ready') return null
          const img = box.querySelector('.card-preview-image')
          if (!img || !img.complete || img.naturalWidth === 0) return null
          if (${JSON.stringify(previous)} !== null && img.src === ${JSON.stringify(previous)}) return null
          const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return { src: img.src, template: box.dataset.template, size: box.dataset.size, art: box.dataset.art, b64: btoa(binary) }
        })()`),
      { label: `card ${name}`, timeout: 20_000 },
    )
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(info.b64, 'base64'))
    const { b64: _b64, ...rest } = info
    return rest
  }
  const link = () => ev(`document.querySelector('.link-share .link-field')?.value ?? ''`)
  const decode = (url) =>
    ev(`(async () => {
      const d = new URL(${JSON.stringify(url)}).hash.split('&d=')[1]
      const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/'))
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return JSON.parse(await new Response(stream).text())
    })()`)

  await size(1440, 900)
  await send('Page.navigate', { url: BASE })
  await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
  await ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); window.__old = true; true`,
  )
  await send('Page.reload')
  await waitFor(() => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`), {
    label: 'seeded',
  })

  // 1. 데이터 · 백업 — 단추 둘뿐, 설명 · 공유 없음.
  await click('.app-nav button:nth-child(2)')
  await waitFor(() => ev(`document.querySelector('.data-backdrop')?.hidden === false`), {
    label: 'data dialog',
  })
  const data = await ev(`(() => {
    const d = document.querySelector('#data-dialog')
    return { buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()), text: d.textContent.replace(/\\s+/g, ' ').trim() }
  })()`)
  record(
    '데이터 · 백업: 단추는 전체 백업 내보내기 · 백업 가져오기뿐, 설명 · 공유 없음',
    JSON.stringify(data.buttons) === JSON.stringify(['×', '전체 백업 내보내기', '백업 가져오기']) &&
      !/공유|평문|JSON|ARTWORK/.test(data.text),
    data,
  )
  await shot('data-dialog-1440')
  await ev(`document.querySelector('[aria-label="데이터 닫기"]').click(); true`)
  await sleep(300)

  // 2. 데크 아이콘 → 공유 대화상자만 (데이터 · 백업은 닫힌 채), 고르는 칸 없음, 카드가 먼저.
  await click('.deck-share')
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  let state = await dialogState()
  const order = await ev(
    `(() => { const d = document.querySelector('.share-dialog'); const c = d.querySelector('.card-share'); const l = d.querySelector('.link-share'); return !!c && !!l && (c.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 })()`,
  )
  record(
    '데크 공유 → 공유 대화상자만 뜬다 · 고르는 칸 없음 · 카드 다음 링크',
    state.share &&
      !state.data &&
      state.kind === '플레이리스트' &&
      state.name === '여름 밤 플레이리스트' &&
      state.options === 0 &&
      order,
    state,
  )
  let card = await grab('jcard-kawaii')
  let content = await decode(await link())
  record(
    '목록: J카드 · 링크에 곡 이름, Moments 없음',
    card.template === 'jcard' &&
      card.size === '1080x1350' &&
      content.t.every((track) => typeof track[1] === 'string' && track[1] !== '') &&
      (content.m ?? []).length === 0,
    { card, tracks: content.t.length, moments: content.m ?? null },
  )
  await shot('share-dialog-1440')
  await size(390, 844)
  await sleep(500)
  await shot('share-dialog-390')
  const phone = await ev(
    `(() => { const r = document.querySelector('.share-dialog').getBoundingClientRect(); return { left: r.left, right: r.right, scroll: document.documentElement.scrollWidth } })()`,
  )
  record('390px: 공유 대화상자가 화면 안', phone.left >= 0 && phone.right <= 390, phone)
  await size(1440, 900)
  await setTheme('mono-vinyl')
  card = await grab('lp-mono', card.src)
  record('목록(Mono): LP 뒷면', card.template === 'lp' && card.size === '1080x1080', card)
  await setTheme('kawaii-synth-cassette')
  await closeShare()

  // 3. 곡 공유 — 지금 재생 카드의 아이콘. 그 곡의 Moments 3개(메모 포함), 기본 그림 없음, 높이는 내용만큼.
  await click('.now-playlist .play-all')
  await waitFor(() => ev(`!!document.querySelector('.action-row .share:not([disabled])')`), {
    label: 'share icon',
  })
  await click('.action-row .share')
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  state = await dialogState()
  card = await grab('single-kawaii-moments')
  content = await decode(await link())
  record(
    '곡: 대상 한 줄 · Moments 3개와 메모가 링크에 기본으로',
    state.kind === '곡' &&
      state.detail === 'Moment 3개' &&
      content.m?.length === 3 &&
      content.m.some((m) => (m[2] ?? '').includes('이어폰')),
    { state: { kind: state.kind, detail: state.detail }, moments: content.m },
  )
  const [, height] = card.size.split('x').map(Number)
  record(
    '곡(Kawaii): 싱글 · 그림 없음 · 높이는 내용만큼',
    card.template === 'single' && card.art === 'false' && height !== 1350,
    card,
  )
  await setTheme('mono-vinyl')
  card = await grab('single-mono-moments', card.src)
  record('곡(Mono): 싱글 · 그림 없음', card.template === 'single' && card.art === 'false', card)
  await setTheme('kawaii-synth-cassette')
  await closeShare()

  // 4. Moments 가 없는 곡 — 곡 이름만, 최소 높이.
  await click('.now-playlist .track-row:nth-child(1)')
  await ev(`[...document.querySelectorAll('.now-playlist .track-row')][2]?.click(); true`)
  await sleep(800)
  await click('.action-row .share')
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  card = await grab('single-kawaii-title-only', card.src)
  record('Moments 없는 곡: 곡 이름만 (1080×640)', card.size === '1080x640', card)
  await closeShare()

  // 5. Moment 하나 — Moments 관리의 "링크로 공유".
  await click('.app-nav button')
  await sleep(300)
  await click('#archive-tab-moments')
  await waitFor(
    () =>
      ev(`(() => {
        const manage = document.querySelector('[data-moment-manage="m3"]')
        if (manage) return true
        // 지금 곡(Moments 없음)의 보기로 열린다 — "전체" 로 바꾼다.
        ;[...document.querySelectorAll('.filter .chip')].find((b) => b.textContent.trim().startsWith('전체'))?.click()
        return false
      })()`),
    { label: 'moment row', timeout: 10_000 },
  )
  await ev(`document.querySelector('[data-moment-manage="m3"]').click(); true`)
  await sleep(200)
  await ev(`document.querySelector('[data-moment-share="m3"]').click(); true`)
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  state = await dialogState()
  card = await grab('moment-kawaii', card.src)
  content = await decode(await link())
  record(
    'Moment: 시점 · 메모 기본 포함 · 싱글',
    state.kind === 'Moment' &&
      state.detail === '3:21' &&
      content.m?.[0]?.[2]?.includes('브릿지') &&
      card.template === 'single',
    { detail: state.detail, moment: content.m?.[0], card },
  )
  await closeShare()
  await ev(`document.querySelector('[aria-label="보관함 닫기"]:not([hidden])')?.click(); true`)
  await sleep(300)

  // 5b. 사용자 그림이 있는 곡 — 그 그림만 넣는다(39page 기본 그림은 없다).
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
  await ev(
    `(() => { const t = document.querySelector('button[aria-label="잔나비 - 주저하는 연인들을 위해 공유"]'); t.click(); return true })()`,
  )
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  card = await grab('single-kawaii-art', card.src)
  record(
    '그림 있는 곡(Kawaii): 싱글에 그 그림',
    card.template === 'single' && card.art === 'true',
    card,
  )
  await setTheme('mono-vinyl')
  card = await grab('single-mono-art', card.src)
  record(
    '그림 있는 곡(Mono): 싱글에 그 그림',
    card.template === 'single' && card.art === 'true',
    card,
  )
  await setTheme('kawaii-synth-cassette')
  await closeShare()
  await ev(`document.querySelector('[aria-label="보관함 닫기"]:not([hidden])')?.click(); true`)
  await sleep(300)

  // 6. 영수증 — 12곡 목록, 재생 표시만.
  await ev(`document.querySelector('.now-playlist .switch-list')?.click(); true`)
  await sleep(200)
  await ev(
    `[...document.querySelectorAll('.now-playlist .picker-row')].find((b) => b.textContent.includes('드라이브 12곡'))?.click(); true`,
  )
  await sleep(1000)
  await click('.deck-share')
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  card = await grab('receipt-kawaii', card.src)
  record('12곡 목록: 영수증', card.template === 'receipt', card)
  await closeShare()

  // 7. 받는 쪽 — 만든 링크를 새 탭에서 열면 미리보기.
  await click('.deck-share')
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  const url = (await link()).replace(/^https?:\/\/[^/#]+/, BASE)
  await closeShare()
  const r = await h.tab(url)
  await waitFor(() => r.ev(`!!document.querySelector('.share-link-dialog')`), {
    label: 'receiver dialog',
    timeout: 20_000,
  })
  const received = await r.ev(
    `document.querySelector('.share-link-dialog').textContent.replace(/\\s+/g, ' ')`,
  )
  record('받는 쪽: 링크를 열면 미리보기 (목록 이름)', received.includes('드라이브 12곡'), {
    received: received.slice(0, 120),
  })

  // 8. Esc 로 닫고 연 단추로 포커스.
  await ev(
    `document.querySelector('.deck-share').focus(); document.querySelector('.deck-share').click(); true`,
  )
  await waitFor(async () => (await dialogState()).share, { label: 'share dialog' })
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await sleep(300)
  record(
    'Esc 로 닫고 연 단추로 포커스가 돌아온다',
    await ev(
      `!document.querySelector('.share-dialog') && document.activeElement?.classList.contains('deck-share')`,
    ),
  )
} finally {
  h.cdp.close()
  h.kill()
  await sleep(1000)
}

writeFileSync(
  path.join(OUT, 'real-chrome-share-dialog.json'),
  `${JSON.stringify({ observedAt: new Date().toISOString(), base: BASE, results }, null, 2)}\n`,
)
const failed = results.filter((r) => !r.pass)
console.log(`${String(results.length - failed.length)}/${String(results.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
