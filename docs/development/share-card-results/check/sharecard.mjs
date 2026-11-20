// ADR 0041 — 공유 카드 이미지 실제 Chrome 확인: 두 테마 × (목록 10 · 30 · 60곡, 곡, Moment) 를 실제 캔버스로 그려 PNG 로
// 받고, 크기 · 바탕색 · 복사(클립보드) · 저장(내려받기)을 본다. 로컬 빌드 · 격리된 임시 프로필만 쓴다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/share-card-results/check/sharecard.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/share-card-results')
mkdirSync(OUT, { recursive: true })

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
let state = 7
const random = () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randomId = () =>
  Array.from({ length: 11 }, () => ALPHABET[Math.floor(random() * 64)]).join('')

const TITLES = [
  '아이유 - 밤편지 (Through the Night) MV',
  'AKMU - 어떻게 이별까지 사랑하겠어, 널 사랑하는 거지',
  'Lauv - Paris in the Rain [Official Audio]',
  '검정치마 - EVERYTHING',
  'NewJeans (뉴진스) Ditto Official MV',
  '잔나비 - 주저하는 연인들을 위해',
  'Crush - 잊어버리지마 (Feat. 태연)',
  '혁오 - TOMBOY',
  'Daniel Caesar - Best Part (feat. H.E.R.)',
  '백예린 - Square (2017)',
  '10CM - 봄이 좋냐??',
  'Coldplay - Yellow (Official Video)',
  '데이식스 - 한 페이지가 될 수 있게',
  'The Weeknd - Blinding Lights (Official Audio)',
  '윤하 - 사건의 지평선 (Event Horizon)',
]
const list = (id, name, count) => ({
  id,
  name,
  tracks: Array.from({ length: count }, (_, i) => ({
    id: `${id}${String(i)}`,
    source: 'youtube',
    videoId: id === 'a' && i === 0 ? 'aqz-KE-bpKQ' : randomId(),
    title: TITLES[i % TITLES.length],
  })),
})
const lists = [
  list('a', '여름 밤 플레이리스트', 10),
  list('b', '드라이브 30곡', 30),
  list('c', '긴 목록 60곡', 60),
]
const seed = { version: 1, data: { playlists: lists, selectedPlaylistId: 'a' } }
const moments = {
  version: 1,
  data: [
    {
      id: 'm1',
      source: 'youtube',
      videoId: lists[0].tracks[0].videoId,
      atSeconds: 83,
      note: '여기 후렴, 이어폰으로 꼭 들어 봐',
      title: lists[0].tracks[0].title,
      createdAt: '2026-11-20T01:00:00.000Z',
      updatedAt: '2026-11-20T01:00:00.000Z',
    },
    {
      id: 'm2',
      source: 'youtube',
      videoId: lists[0].tracks[6].videoId,
      atSeconds: 161,
      note: '',
      title: lists[0].tracks[6].title,
      createdAt: '2026-11-20T01:00:00.000Z',
      updatedAt: '2026-11-20T01:00:00.000Z',
    },
  ],
}

const results = []
const images = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 400))
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
  await h.cdp.send('Browser.grantPermissions', {
    origin: BASE,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  const size = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768,
    })
  await size(1440, 900)
  await send('Page.navigate', { url: BASE })
  await waitFor(() => ev(`!!document.querySelector('.now-playlist')`), { label: 'app' })
  await ev(
    `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); true`,
  )
  await ev(`window.__old = true; true`)
  await send('Page.reload')
  await waitFor(() => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`), {
    label: 'seeded',
  })

  const click = async (selector, text) => {
    const point = await ev(
      `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${JSON.stringify(text ?? null)} === null || x.textContent.trim() === ${JSON.stringify(text ?? '')}); if (!e) throw Error('no element ' + ${JSON.stringify(`${selector} ${text ?? ''}`)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    await sleep(250)
  }
  const closeDialog = async () => {
    await ev(`document.querySelector('[aria-label="데이터 닫기"]')?.click(); true`)
    await waitFor(() => ev(`document.querySelector('.data-backdrop')?.hidden === true`), {
      label: 'dialog closed',
    })
    await sleep(150)
  }
  /** 토글 단추는 닫혀 있을 때만 누른다 — 앞 단계에서 펼친 채 남아 있을 수 있다. */
  const expand = async (selector) => {
    if (
      (await ev(
        `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')`,
      )) !== 'true'
    ) {
      await click(selector)
    }
  }
  const openArchive = async () => {
    if (await ev(`document.querySelector('#archive-panel')?.hidden !== false`)) {
      await click('.app-nav button')
      await sleep(300)
    }
  }
  /**
   * 미리보기가 다 그려질 때까지(`data-state="ready"`) 기다리고 PNG 바이트를 받는다. 대화상자는 닫아도 남으므로 지난 카드를
   * 잡지 않게 `previous`(지난 src) · `label`(틀 이름)로 새 카드인지 본다.
   */
  const grab = async (name, { previous = null, label = null, save = true } = {}) => {
    const info = await waitFor(
      () =>
        ev(`(async () => {
          if (document.querySelector('.card-share .card-preview')?.dataset.state !== 'ready') return null
          const img = document.querySelector('.card-share .card-preview-image')
          if (!img || !img.complete || img.naturalWidth === 0) return null
          if (${JSON.stringify(previous)} !== null && img.src === ${JSON.stringify(previous)}) return null
          const meta = document.querySelector('.card-share .meta')?.textContent.trim() ?? ''
          if (${JSON.stringify(label)} !== null && !meta.startsWith(${JSON.stringify(label)})) return null
          const blob = await (await fetch(img.src)).blob()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
          return { src: img.src, width: img.naturalWidth, height: img.naturalHeight, bytes: bytes.length, b64: btoa(binary), corner: pixel(4, img.naturalHeight - 4), cornerRight: pixel(img.naturalWidth - 4, img.naturalHeight - 4), top: pixel(4, 4), meta: document.querySelector('.card-share .meta')?.textContent.trim() ?? null }
        })()`),
      { label: `card ${name}`, timeout: 20_000 },
    )
    if (!save) return info
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(info.b64, 'base64'))
    images.push({
      name,
      width: info.width,
      height: info.height,
      bytes: info.bytes,
      meta: info.meta,
    })
    return info
  }

  /** 보관함에서 목록의 "관리" 를 펼치고 "이 목록 공유" 를 누른다. */
  const shareList = async (name) => {
    await openArchive()
    await expand(`.archive-lists [aria-label="${name} 관리 — 이름 수정 · 삭제"]`)
    await click(`.archive-lists [aria-label="${name} 목록 공유"]`)
  }

  let card = null
  // 바탕 픽셀 — Mono 의 LP · 싱글은 왼쪽 위(bg2)에서 오른쪽 아래(bg)로 비스듬한 그라데이션이다.
  const expected = {
    kawaii: { top: '10202c', corner: '10202c' },
    mono: { top: '1f1d1a', corner: '171614' },
  }

  for (const theme of ['kawaii', 'mono']) {
    if (theme === 'mono') {
      await ev(
        `[...document.querySelectorAll('.theme-button')].find((b) => !b.classList.contains('is-active'))?.click(); true`,
      )
      await sleep(300)
    }
    const themeNow = await ev(`document.documentElement.dataset.theme`)

    // 목록 10곡
    await shareList(lists[0].name)
    card = await grab(`${theme}-playlist-10`, {
      label: theme === 'kawaii' ? '카세트 J카드' : 'LP 뒷면',
    })
    record(
      `${theme}: 목록 10곡 — ${theme === 'kawaii' ? 'J카드 1080×1350' : 'LP 1080×1080'}`,
      card.width === 1080 && card.height === (theme === 'kawaii' ? 1350 : 1080),
      {
        themeNow,
        meta: card.meta,
        size: `${card.width}x${card.height}`,
        bytes: card.bytes,
        top: card.top,
      },
    )

    // Moments · 메모 넣기 → 다시 그림
    await click('.link-share label.check', `이 곡들의 Moments 2개 넣기`)
    card = await grab(`${theme}-playlist-10-moments`, { previous: card.src })
    record(`${theme}: Moments 를 넣으면 다시 그린다`, card.width === 1080, { meta: card.meta })

    // 이미지 복사 → 실제 클립보드
    await click('.card-share button', '이미지 복사')
    await sleep(400)
    const clip = await ev(`(async () => {
      const items = await navigator.clipboard.read()
      const types = items.flatMap((item) => item.types)
      const blob = types.includes('image/png') ? await items[0].getType('image/png') : null
      return { types, size: blob?.size ?? 0, status: document.querySelector('.card-share .status')?.textContent.trim() }
    })()`).catch((error) => ({ error: error.message }))
    record(
      `${theme}: "이미지 복사" — 클립보드에 PNG`,
      Array.isArray(clip.types) && clip.types.includes('image/png') && clip.size > 1000,
      clip,
    )

    // 이미지 저장 → 내려받기 (앵커 클릭을 가로채 바이트를 본다)
    await ev(
      `(() => { window.__download = null; if (!window.__captureDownload) { window.__captureDownload = true; const original = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (!this.download) return original.call(this); const name = this.download; fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { const v = new Uint8Array(b); window.__download = { name, size: v.length, png: v[0] === 0x89 && v[1] === 0x50 && v[2] === 0x4e && v[3] === 0x47 } }) } } return true })()`,
    )
    await click('.card-share button', '이미지 저장')
    const saved = await waitFor(() => ev(`window.__download`), {
      label: 'download',
      timeout: 10_000,
    })
    record(
      `${theme}: "이미지 저장" — <목록 이름>.39page.png`,
      saved.name === '여름 밤 플레이리스트.39page.png' && saved.png && saved.size > 1000,
      saved,
    )
    await closeDialog()

    // 30곡 · 60곡 → 영수증
    for (const [index, count] of [
      [1, 30],
      [2, 60],
    ]) {
      await shareList(lists[index].name)
      card = await grab(`${theme}-receipt-${count}`, { previous: card.src, label: '영수증' })
      const expectedHeight =
        count === 60
          ? card.height <= 3240 && card.height > 2900
          : card.height > 1700 && card.height < 3240
      record(
        `${theme}: 목록 ${count}곡 — 영수증 (높이 ${count === 60 ? '상한 3240 + "+N곡 더"' : '곡 수만큼'})`,
        card.width === 1080 && expectedHeight,
        {
          size: `${card.width}x${card.height}`,
          meta: card.meta,
          corner: card.corner,
          bg: card.top,
        },
      )
      await closeDialog()
    }

    // 곡 하나 — 목록 a 의 첫 곡
    await openArchive()
    await click('.archive-lists .list-row .list-select')
    const first = TITLES[0]
    await expand(`button.track-manage[aria-label="${first} 관리"]`)
    await click(`[aria-label="${first} 공유"]`)
    card = await grab(`${theme}-track`, { previous: card.src, label: '싱글' })
    record(
      `${theme}: 곡 하나 — 싱글 ${theme === 'kawaii' ? '1080×1350' : '1080×1080'}`,
      card.width === 1080 &&
        card.height === (theme === 'kawaii' ? 1350 : 1080) &&
        card.top === expected[theme].top &&
        card.cornerRight === expected[theme].corner,
      {
        size: `${card.width}x${card.height}`,
        top: card.top,
        cornerRight: card.cornerRight,
        meta: card.meta,
      },
    )
    await closeDialog()

    // Moment (메모 포함)
    await openArchive()
    await click('#archive-tab-moments')
    await waitFor(() => ev(`!!document.querySelector('[data-moment-manage="m1"]')`), {
      label: 'moments',
    })
    await expand('[data-moment-manage="m1"]')
    await click('[data-moment-share="m1"]')
    await waitFor(() => ev(`!!document.querySelector('.moment-target')`), { label: 'moment share' })
    card = await grab(`${theme}-moment-plain`, { previous: card.src, label: '싱글' })
    await click('.link-share label.check', 'Moment 메모 넣기')
    card = await grab(`${theme}-moment`, { previous: card.src, label: '싱글' })
    record(
      `${theme}: Moment — 싱글 + 시점 · 메모`,
      card.width === 1080 && card.height === (theme === 'kawaii' ? 1350 : 1080),
      { size: `${card.width}x${card.height}`, meta: card.meta },
    )
    await closeDialog()
    await click('#archive-tab-music').catch(() => {})
  }

  // 좁은 화면 — 공유 대화상자의 카드 칸. 보관함은 좁으면 다른 배치라 넓을 때 대화상자를 열고 창을 줄인다.
  await shareList(lists[0].name)
  await grab('narrow-check', { previous: card?.src ?? null, label: 'LP 뒷면', save: false })
  await size(390, 844)
  await sleep(400)
  const narrow = await ev(
    `(() => { const d = document.querySelector('#data-dialog'); const img = document.querySelector('.card-share .card-preview-image').getBoundingClientRect(); const box = document.querySelector('.card-share').getBoundingClientRect(); return { overflowX: d.scrollWidth > d.clientWidth + 1, inside: img.left >= box.left - 0.5 && img.right <= box.right + 0.5, imgWidth: Math.round(img.width) } })()`,
  )
  record(
    '390px — 카드 미리보기가 대화상자 안에 들어가고 가로로 넘치지 않는다',
    !narrow.overflowX && narrow.inside,
    narrow,
  )
  const box = await ev(
    `(() => { const e = document.querySelector('.card-share'); e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: Math.min(r.height, innerHeight) } })()`,
  )
  await sleep(200)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })
  writeFileSync(path.join(OUT, 'panel-390.png'), Buffer.from(shot.data, 'base64'))
} catch (error) {
  record('실행 오류', false, { error: error.message })
} finally {
  h.cdp.close()
  h.kill()
  await sleep(1500)
}

const passed = results.filter((r) => r.pass).length
writeFileSync(
  path.join(OUT, 'real-chrome-sharecard.json'),
  `${JSON.stringify({ when: new Date().toISOString(), passed, total: results.length, images, results }, null, 2)}\n`,
)
console.log(`${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
