// ADR 0046 — 가사 위젯 · 고정 높이 목록 · 푸터 삭제를 실제 Chrome 에서 본다.
// 합성 데이터 · 격리된 임시 프로필 · 로컬 빌드. LRCLIB 요청은 CDP 로 가로채 **합성 응답**을 준다 — 실제 서비스를
// 부르지 않는다(가사 글자도 합성). 영상은 기존 확인과 같은 공개 영상(Big Buck Bunny)을 실제로 재생한다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/lyrics-results/check/lyrics.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve(process.env.OUT ?? 'docs/development/lyrics-results')
mkdirSync(OUT, { recursive: true })

const BUNNY = 'aqz-KE-bpKQ'
const track = (i, title, videoId) => ({ id: `t${String(i)}`, source: 'youtube', videoId, title })
const library = (count) => ({
  version: 1,
  data: {
    playlists: [
      {
        id: 'a',
        name: 'MY RECORDS',
        tracks: [
          track(0, 'HACHI - DUNE ft Miku Hatsune', BUNNY),
          track(1, '메스머라이저 / 하츠네 미쿠・카사네 테토', 'eRsGyueVLvQ'),
          ...Array.from({ length: Math.max(0, count - 2) }, (_, i) =>
            track(i + 2, `곡 ${String(i + 3)}`, `x${String(i).padStart(10, '0')}`),
          ),
        ],
      },
    ],
    selectedPlaylistId: 'a',
  },
})
const moments = (count) => ({
  version: 1,
  data: Array.from({ length: count }, (_, i) => ({
    id: `m${String(i)}`,
    source: 'youtube',
    videoId: BUNNY,
    atSeconds: 10 + i * 7,
    note: `메모 ${String(i + 1)}`,
    title: 'HACHI - DUNE ft Miku Hatsune',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  })),
})

/** 합성 LRC — 2초마다 한 줄, 3분. */
const SYNCED = Array.from({ length: 90 }, (_, i) => {
  const t = i * 2
  return `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}.00]합성 가사 ${String(i + 1)}번째 줄`
}).join('\n')
/** 영상 길이를 모르므로 길이가 5초 간격인 같은 곡 레코드를 준다 — 하나는 ±4초 안에 든다. */
const DUNE_RECORDS = Array.from({ length: 41 }, (_, i) => ({
  id: 1000 + i,
  trackName: 'DUNE (feat. Hatsune Miku)',
  artistName: 'Hachi',
  albumName: '',
  duration: 500 + i * 5,
  instrumental: false,
  plainLyrics: 'plain',
  syncedLyrics: SYNCED,
}))
const MESMERIZER = {
  id: 17414640,
  trackName: 'Mesmerizer',
  artistName: '32ki',
  albumName: '',
  duration: 157,
  instrumental: false,
  plainLyrics: '합성 일반 가사 첫 줄\n둘째 줄',
  syncedLyrics: null,
}

function lrclibResponse(url) {
  const parsed = new URL(url)
  if (parsed.pathname === '/api/get/17414640') return MESMERIZER
  if (parsed.pathname !== '/api/search') return null
  const q = (parsed.searchParams.get('q') ?? '').toLowerCase()
  if (q.includes('dune') || q.includes('hachi')) return DUNE_RECORDS
  if (q.includes('mesmerizer')) return [MESMERIZER]
  return []
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

  // LRCLIB 가로채기 — 사전 요청(OPTIONS)과 본 요청 모두.
  const lrclib = { requests: [], headers: [] }
  await send('Fetch.enable', { patterns: [{ urlPattern: '*lrclib.net*' }] })
  const cors = [
    { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Access-Control-Allow-Headers', value: 'content-type,lrclib-client' },
    { name: 'Access-Control-Allow-Methods', value: '*' },
  ]
  const onPaused = async ({ requestId, request }) => {
    if (request.method === 'OPTIONS') {
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: cors })
      return
    }
    lrclib.requests.push(request.url)
    lrclib.headers.push({
      client: request.headers['Lrclib-Client'],
      referer: request.headers.Referer ?? null,
    })
    const body = lrclibResponse(request.url)
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: body === null ? 404 : 200,
      responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body ?? { name: 'TrackNotFound' })).toString('base64'),
    })
  }
  h.cdp.on((message) => {
    if (message.method === 'Fetch.requestPaused' && message.sessionId === p.session) {
      void onPaused(message.params)
    }
  })

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
  const boxes = () =>
    ev(
      `(() => { const r = (s) => { const e = document.querySelector('[data-widget="' + s + '"]'); const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), height: Math.round(b.height) } }; return { page: document.documentElement.scrollHeight, deck: r('deck'), player: r('player'), playlist: r('playlist'), moments: r('moments'), lyrics: r('lyrics'), gap: parseFloat(getComputedStyle(document.querySelector('.widget-host')).rowGap) } })()`,
    )
  async function load(trackCount, momentCount) {
    await send('Page.navigate', { url: BASE })
    await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
    await ev(
      `localStorage.clear(); localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(library(trackCount)))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments(momentCount)))}); window.__old = true; true`,
    )
    await send('Page.reload')
    await waitFor(() => ev(`!window.__old && !!document.querySelector('.lyrics-widget')`), {
      label: 'loaded',
    })
    await sleep(500)
  }

  // 1. 배치 · 고정 높이 · 푸터 (1440 · 1920 · 1000 · 390).
  const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance
  for (const [w, hh] of [
    [1440, 900],
    [1920, 1080],
    [1000, 800],
    [390, 844],
  ]) {
    await size(w, hh)
    await load(2, 0)
    const few = await boxes()
    await load(30, 20)
    const many = await boxes()
    const footer = await ev(
      `!!document.querySelector('footer') || document.body.innerText.includes('PLAYLIST FIRST')`,
    )
    let placed
    if (w > 1100) {
      placed =
        near(many.lyrics.top, many.player.bottom + many.gap) &&
        near(many.lyrics.bottom, Math.max(many.playlist.bottom, many.moments.bottom)) &&
        near(many.playlist.top, many.deck.bottom + many.gap, 4) &&
        many.lyrics.height >= 160
    } else if (w > 700) {
      placed =
        near(many.lyrics.left, many.deck.left) &&
        near(many.lyrics.top, many.deck.bottom + many.gap) &&
        near(many.lyrics.bottom, many.playlist.bottom) &&
        many.lyrics.height >= 160
    } else {
      placed =
        many.lyrics.top > many.moments.bottom &&
        many.lyrics.bottom < many.playlist.top &&
        many.lyrics.height === 260
    }
    const fixed = w > 700 ? few.page === many.page : true
    record(
      `${String(w)}×${String(hh)}: 가사 자리 · ${w > 700 ? '곡 · 순간 수와 무관한 페이지 높이' : '한 열(목록은 펼침 — 높이 고정 아님)'} · 푸터 없음`,
      placed && fixed && !footer,
      {
        few: few.page,
        many: many.page,
        lyrics: many.lyrics,
        player: many.player,
        deck: many.deck,
        playlist: many.playlist,
        footer,
      },
    )
    if (w === 1440 || w === 1000 || w === 390) await shot(`layout-${String(w)}`)
  }

  // 2. 재생 → 자동 찾기 → 싱크 줄이 재생을 따라간다.
  await size(1440, 900)
  await load(2, 0)
  await click('.now-playlist .play-all')
  const playing = await waitFor(
    () =>
      ev(
        `document.querySelector('.now-playing-card .status')?.innerText.includes('재생') || document.querySelector('.state-chip.is-playing')?.innerText === '재생 중'`,
      ),
    { label: 'playing', timeout: 30000 },
  ).then(
    () => true,
    () => false,
  )
  await waitFor(() => ev(`document.querySelectorAll('.lyrics-widget .line').length > 0`), {
    label: 'lyrics lines',
    timeout: 20000,
  })
  const first = await ev(
    `document.querySelector('.lyrics-widget .line.is-active')?.dataset.line ?? null`,
  )
  await sleep(4500)
  const synced = await ev(`(() => {
    const body = document.querySelector('.lyrics-body')
    const line = document.querySelector('.lyrics-widget .line.is-active')
    const b = body.getBoundingClientRect(); const l = line?.getBoundingClientRect()
    return { index: line?.dataset.line ?? null, text: line?.innerText ?? '', visible: !!l && l.top >= b.top - 1 && l.bottom <= b.bottom + 1, sub: document.querySelector('.lyrics-widget .widget-sub')?.innerText ?? '', pageScroll: scrollY }
  })()`)
  record(
    '자동: 제목의 영어 낱말로 찾고 곡 길이로 고른 싱크 가사 · 재생을 따라 지금 줄이 바뀌고 칸 안에 보인다',
    playing &&
      synced.index !== null &&
      Number(synced.index) > Number(first ?? -1) &&
      synced.visible &&
      synced.sub.startsWith('DUNE'),
    { playing, first, ...synced },
  )
  await shot('lyrics-synced-1440')
  const sent = {
    queries: lrclib.requests.map((u) => new URL(u).searchParams.get('q') ?? new URL(u).pathname),
    clients: [...new Set(lrclib.headers.map((x) => x.client))],
    referers: [...new Set(lrclib.headers.map((x) => x.referer))],
  }
  record(
    'LRCLIB 요청: 영어 낱말 검색어 하나 · 이 앱을 밝히는 머리 · 39page 주소(Referer) 없음',
    sent.queries.length === 1 &&
      sent.queries[0] === 'hachi dune miku hatsune' &&
      sent.clients[0] === '39page (https://39page.com)' &&
      sent.referers.length === 1 &&
      sent.referers[0] === null,
    sent,
  )

  // 3. 못 찾는 곡(한국어 제목) → 직접 찾아 고르기 → 다음에 바로.
  await click('button[aria-label="다음 곡"]')
  await waitFor(
    () =>
      ev(`document.querySelector('.lyrics-widget .message')?.innerText.includes('찾지 못했어요')`),
    {
      label: 'not found',
      timeout: 20000,
    },
  )
  await click('[data-lyrics-search]')
  await ev(
    `(() => { const i = document.querySelector('.lyrics-widget input[type=search]'); i.value = 'Mesmerizer 32ki'; i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return true })()`,
  )
  await waitFor(() => ev(`!!document.querySelector('[data-lyrics-result="17414640"]')`), {
    label: 'result',
  })
  await click('[data-lyrics-result="17414640"]')
  const manual = await ev(
    `({ sub: document.querySelector('.lyrics-widget .widget-sub')?.innerText, plain: document.querySelector('.lyrics-widget .plain')?.innerText, stored: JSON.parse(localStorage.getItem('39page.lyrics')) })`,
  )
  record(
    '직접 찾기: 영어 제목으로 찾아 고르면 일반 가사 · "직접 고름" · 그 곡에 기억',
    manual.sub?.includes('직접 고름') &&
      manual.plain?.startsWith('합성 일반 가사') &&
      manual.stored?.data?.picks?.eRsGyueVLvQ?.id === 17414640,
    manual,
  )
  await shot('lyrics-manual-1440')

  // 4. 테마 전환 · 보관함 열기에도 가사는 그대로(보관함이 열리면 가사 칸은 숨는다).
  const before = await ev(`document.querySelector('.lyrics-widget .plain')?.innerText`)
  await click('.theme-button:nth-child(2)')
  await click('.app-nav button')
  await sleep(500)
  const hidden = await ev(
    `getComputedStyle(document.querySelector('[data-widget="lyrics"]')).display`,
  )
  await ev(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
  )
  await sleep(500)
  const after = await ev(`document.querySelector('.lyrics-widget .plain')?.innerText`)
  record(
    '테마 전환 · 보관함을 열고 닫아도 가사가 그대로 (열린 동안 가사 칸은 숨음)',
    before === after && hidden === 'none',
    { hidden, same: before === after },
  )
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-lyrics.json'),
    `${JSON.stringify({ date: new Date().toISOString(), results }, null, 2)}\n`,
  )
  await h.kill()
}
const failed = results.filter((r) => !r.pass)
console.log(`${String(results.length - failed.length)}/${String(results.length)}`)
if (failed.length > 0 || results.length === 0) process.exitCode = 1
