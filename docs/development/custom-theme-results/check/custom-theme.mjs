// ADR 0045 — 커스텀 테마(데크 그림 · 다섯 색)를 실제 Chrome 에서 본다.
// 합성 데이터 · 격리된 임시 프로필 · 로컬 빌드만 쓴다. 올리는 그림은 이 스크립트가 만든 합성 PNG · GIF 다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/custom-theme-results/check/custom-theme.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve(process.env.OUT ?? 'docs/development/custom-theme-results')
const TMP = path.resolve('node_modules/.tmp/custom-theme-check')
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const list = (id, name, titles) => ({
  id,
  name,
  tracks: titles.map((title, i) => ({
    id: `${id}${String(i)}`,
    source: 'youtube',
    videoId: `${id}x${String(i).padStart(9, '0')}`.slice(0, 11),
    title,
  })),
})
const seed = {
  version: 1,
  data: {
    playlists: [list('a', '밤 산책', ['곡 하나', '곡 둘', '곡 셋'])],
    selectedPlaylistId: 'a',
  },
}

/** 1×1 두 프레임 GIF (빨강 → 파랑) — 움직이는 그림. LZW 최소 코드 2, 프레임마다 지연 0.2초 · 무한 반복. */
function twoFrameGif() {
  const frame = (data) => [
    0x21,
    0xf9,
    0x04,
    0x00,
    0x14,
    0x00,
    0x00,
    0x00, // 그래픽 제어 — 지연 20/100 초
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // 이미지 1×1
    0x02,
    0x02,
    ...data,
    0x00,
  ]
  return Buffer.from([
    ...Buffer.from('GIF89a'),
    0x01,
    0x00,
    0x01,
    0x00,
    0x80,
    0x00,
    0x00, // 1×1, 색표 2색
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff, // 빨강 · 파랑
    0x21,
    0xff,
    0x0b,
    ...Buffer.from('NETSCAPE2.0'),
    0x03,
    0x01,
    0x00,
    0x00,
    0x00, // 반복
    ...frame([0x44, 0x01]), // 색 0
    ...frame([0x4c, 0x01]), // 색 1
    0x3b,
  ])
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
  await send('DOM.enable')
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
  const upload = async (file) => {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeId } = await send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.custom-dialog input[type="file"]',
    })
    await send('DOM.setFileInputFiles', { nodeId, files: [file] })
  }
  const setColor = (key, value) =>
    ev(
      `(() => { const i = document.querySelector('[data-custom-color="${key}"]'); i.value = '${value}'; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
    )
  const rootVar = (name) =>
    ev(`getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`)
  const bodyBg = () => ev(`getComputedStyle(document.body).backgroundColor`)

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
  await sleep(400)

  // 합성 그림 — 페이지 캔버스로 PNG 를 만든다 (사용자 파일이 아니다).
  const pngBase64 = await ev(`(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 570
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 900, 570); grad.addColorStop(0, '#ff5ea8'); grad.addColorStop(1, '#3a1d7a')
    g.fillStyle = grad; g.fillRect(0, 0, 900, 570)
    g.fillStyle = '#ffffff'; g.font = 'bold 96px sans-serif'; g.fillText('MY DECK', 220, 320)
    return c.toDataURL('image/png').split(',')[1]
  })()`)
  const pngPath = path.join(TMP, 'deck.png')
  writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'))
  const gifPath = path.join(TMP, 'deck.gif')
  writeFileSync(gifPath, twoFrameGif())

  const playerNode = await ev(
    `(() => { window.__player = document.querySelector('.player-mount'); return !!window.__player })()`,
  )

  // 1. 테마 셋 · 커스텀 고르기 — 빈 데크와 설정 단추.
  const labels = await ev(
    `[...document.querySelectorAll('.theme-button')].map((b) => b.innerText.trim())`,
  )
  await click('.theme-button:nth-child(3)')
  const empty = await ev(`(() => {
    const art = document.querySelector('.deck-art--custom')
    const add = document.querySelector('.deck-add-image')
    return {
      theme: document.documentElement.dataset.theme,
      art: art && getComputedStyle(art).display,
      artState: art?.dataset.deckImage,
      add: add && getComputedStyle(add).display,
      cassette: getComputedStyle(document.querySelector('.deck-art--kawaii-synth-cassette')).display,
      visibleArts: [...document.querySelectorAll('.deck-art')].filter((e) => getComputedStyle(e).display !== 'none').length,
      settings: !!document.querySelector('.custom-settings'),
    }
  })()`)
  record(
    '테마 셋(01 · 02 · 03 / CUSTOM) · 커스텀을 고르면 커스텀 틀 하나만 · 빈 데크에 "이미지 넣기" · 헤더 설정 단추',
    labels.join('|') === '01 / SYNTH CASSETTE|02 / MONO VINYL|03 / CUSTOM' &&
      empty.theme === 'custom' &&
      empty.art === 'block' &&
      empty.artState === 'empty' &&
      empty.add === 'block' &&
      empty.cassette === 'none' &&
      empty.visibleArts === 1 &&
      empty.settings,
    { labels, ...empty },
  )
  const defaultBg = await bodyBg()

  // 2. 이미지 넣기 → 설정 창 → PNG · 색 미리보기 → 저장.
  await click('.deck-add-image')
  await waitFor(() => ev(`!!document.querySelector('.custom-dialog')`), { label: 'dialog' })
  await upload(pngPath)
  await waitFor(() => ev(`!!document.querySelector('[data-custom-preview] img')`), {
    label: 'preview',
  })
  await setColor('background', '#1b1030')
  await setColor('accent', '#ff5ea8')
  const previewing = {
    accent: await rootVar('--accent-color'),
    bg: await bodyBg(),
    stored: await ev(`localStorage.getItem('39page.customTheme')`),
  }
  record(
    '설정 창: 고른 색이 저장 전에 화면 전체에 보인다 (저장소는 그대로)',
    previewing.accent === '#ff5ea8' && previewing.bg !== defaultBg && previewing.stored === null,
    previewing,
  )
  await shot('dialog-1440')
  await click('[data-custom-save]')
  await waitFor(() => ev(`!document.querySelector('.custom-dialog')`), { label: 'closed' })
  await waitFor(
    () => ev(`document.querySelector('.deck-art--custom')?.dataset.deckImage === 'image'`),
    {
      label: 'deck image',
    },
  )
  const saved = await ev(`(() => {
    const img = document.querySelector('.deck-art--custom img')
    const r = document.querySelector('.deck-art--custom').getBoundingClientRect()
    return {
      natural: img && [img.naturalWidth, img.naturalHeight],
      ratio: +(r.width / r.height).toFixed(3),
      colors: JSON.parse(localStorage.getItem('39page.customTheme')).data.colors,
      add: !!document.querySelector('.deck-add-image'),
    }
  })()`)
  record(
    '저장: 데크 자리에 그림(900 × 570 틀) · 색이 저장된다',
    saved.natural?.[0] === 900 &&
      Math.abs(saved.ratio - 900 / 570) < 0.02 &&
      saved.colors.background === '#1b1030' &&
      saved.colors.accent === '#ff5ea8' &&
      !saved.add,
    saved,
  )
  await shot('dashboard-1440')

  // 3. 데크의 하는 일은 같다 — 그림을 누르면 보관함, ■ · ▶ 는 보이는 단추.
  const keys = await ev(
    `[...document.querySelectorAll('.deck-custom-keys button')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.innerText.trim(), label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), shown: getComputedStyle(b).display !== 'none' } })`,
  )
  await click('.deck-open--custom')
  const opened = await ev(
    `(() => ({ expanded: document.querySelector('.deck-open--custom').getAttribute('aria-expanded'), panel: !document.getElementById('archive-panel').hidden }))()`,
  )
  record(
    '데크: 그림을 누르면 보관함이 열린다 · ■ ▶ 는 이름 있는 보이는 단추',
    opened.expanded === 'true' &&
      opened.panel &&
      keys.length === 2 &&
      keys.every((k) => k.shown && k.label && k.w >= 32 && k.h >= 28),
    { opened, keys },
  )
  await ev(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
  )
  await sleep(400)

  // 4. 새로고침 — 테마 · 색 · 그림이 남는다. 첫 그림 전에 색이 걸린다.
  await send('Page.reload')
  await waitFor(
    () => ev(`document.querySelector('.deck-art--custom')?.dataset.deckImage === 'image'`),
    {
      label: 'reloaded deck',
    },
  )
  const reloaded = {
    theme: await ev(`document.documentElement.dataset.theme`),
    inline: await ev(`document.documentElement.style.getPropertyValue('--custom-background')`),
    accent: await rootVar('--accent-color'),
  }
  record(
    '새로고침: 커스텀 테마 · 색 · 데크 그림이 그대로',
    reloaded.theme === 'custom' && reloaded.inline === '#1b1030' && reloaded.accent === '#ff5ea8',
    reloaded,
  )

  // 5. 움짤 — 재생 전에는 첫 프레임(포스터).
  await click('.custom-settings')
  await waitFor(() => ev(`!!document.querySelector('.custom-dialog')`), { label: 'dialog 2' })
  await upload(gifPath)
  await waitFor(() => ev(`!!document.querySelector('[data-custom-preview] img')`), {
    label: 'gif preview',
  })
  await click('[data-custom-save]')
  await waitFor(
    () => ev(`document.querySelector('.deck-art--custom')?.dataset.deckImage === 'poster'`),
    {
      label: 'gif poster',
    },
  )
  const gif = await ev(`(async () => {
    const img = document.querySelector('.deck-art--custom img')
    const blob = await (await fetch(img.src)).blob()
    return { type: blob.type, state: document.querySelector('.deck-art--custom').dataset.deckImage }
  })()`)
  record(
    '움짤: 재생하지 않을 때는 첫 프레임(PNG 포스터)을 보인다',
    gif.state === 'poster' && gif.type === 'image/png',
    gif,
  )

  // 6. 대비 경고 · 취소하면 되돌아간다.
  await click('.custom-settings')
  await waitFor(() => ev(`!!document.querySelector('.custom-dialog')`), { label: 'dialog 3' })
  await setColor('text', '#1c1236')
  await sleep(200)
  const warn = await ev(`document.querySelector('.custom-dialog .warnings')?.innerText ?? ''`)
  const during = await rootVar('--text-color')
  await click('.custom-dialog .dialog-foot .pill')
  await sleep(300)
  const after = await rootVar('--text-color')
  record(
    '설정 창: 글자 대비가 낮으면 알리고, 취소하면 저장된 색으로 돌아간다',
    /대비/.test(warn) && during === '#1c1236' && after !== '#1c1236',
    { warn, during, after },
  )

  // 7. 공유 카드 — 커스텀은 Kawaii 카드 틀에 고른 배경색.
  await click('.deck-share')
  await waitFor(() => ev(`document.querySelector('.card-preview')?.dataset.state === 'ready'`), {
    label: 'card',
    timeout: 20000,
  })
  const card = await ev(`(async () => {
    const preview = document.querySelector('.card-preview')
    const img = preview.querySelector('.card-preview-image')
    await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const [r, gg, b] = g.getImageData(4, 4, 1, 1).data
    return { template: preview.dataset.template, corner: '#' + [r, gg, b].map((v) => v.toString(16).padStart(2, '0')).join('') }
  })()`)
  record(
    '공유 카드: J카드 틀 · 바탕이 고른 배경색',
    card.template === 'jcard' && card.corner === '#1b1030',
    card,
  )
  await shot('share-card-1440')
  await ev(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
  )
  await sleep(300)

  // 8. 테마를 바꿔도 플레이어 노드 · 고른 색이 그대로, 카세트는 승인된 색. (4 의 새로고침 뒤라 표시를 다시 단다.)
  await ev(`(() => { window.__player = document.querySelector('.player-mount'); return true })()`)
  await click('.theme-button:nth-child(1)')
  const back = {
    samePlayer: await ev(`window.__player === document.querySelector('.player-mount')`),
    accent: await rootVar('--accent-color'),
    customVar: await ev(`document.documentElement.style.getPropertyValue('--custom-accent')`),
    custom: await ev(`getComputedStyle(document.querySelector('.deck-art--custom')).display`),
  }
  record(
    '테마 전환: 카세트로 돌아가면 승인된 색 · 플레이어 노드 그대로 · 고른 색은 남는다',
    back.accent === '#ff9bc5' &&
      back.customVar === '#ff5ea8' &&
      back.custom === 'none' &&
      (back.samePlayer || !playerNode),
    { ...back, playerNode },
  )

  // 9. 390px — 작은 데크 띠: 그림 전체가 열기, ■ ▶ 는 끈다.
  await click('.theme-button:nth-child(3)')
  await size(390, 844)
  await sleep(500)
  const narrow = await ev(`(() => {
    const art = document.querySelector('.deck-art--custom').getBoundingClientRect()
    const open = document.querySelector('.deck-open--custom').getBoundingClientRect()
    return {
      art: [Math.round(art.width), Math.round(art.height)],
      open: [Math.round(open.width), Math.round(open.height)],
      openCovers: Math.abs(open.width - art.width) < 2 && Math.abs(open.height - art.height) < 2,
      keys: getComputedStyle(document.querySelector('.deck-custom-keys')).display,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }
  })()`)
  record(
    '390px: 작은 데크 띠 — 그림 전체가 보관함 열기 · ■ ▶ 끔 · 가로 넘침 없음',
    narrow.art[0] >= 110 &&
      narrow.art[0] <= 170 &&
      narrow.openCovers &&
      narrow.keys === 'none' &&
      !narrow.overflow,
    narrow,
  )
  await shot('dashboard-390')

  // 10. 그림 빼기.
  await size(1440, 900)
  await sleep(300)
  await click('.custom-settings')
  await waitFor(() => ev(`!!document.querySelector('.custom-dialog')`), { label: 'dialog 4' })
  await click('[data-custom-remove]')
  await click('[data-custom-save]')
  await waitFor(
    () => ev(`document.querySelector('.deck-art--custom')?.dataset.deckImage === 'empty'`),
    {
      label: 'removed',
    },
  )
  record(
    '그림 빼기: 데크가 빈 틀과 "이미지 넣기" 로 돌아간다',
    await ev(`!!document.querySelector('.deck-add-image')`),
  )
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-custom-theme.json'),
    `${JSON.stringify({ date: new Date().toISOString(), results }, null, 2)}\n`,
  )
  await h.kill()
}
const failed = results.filter((r) => !r.pass)
console.log(`${String(results.length - failed.length)}/${String(results.length)}`)
if (failed.length > 0 || results.length === 0) process.exitCode = 1
