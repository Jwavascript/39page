// ADR 0044 — 설명 글 줄이기 · 아이콘 단추 · Moments 두 칸을 실제 Chrome 에서 본다.
// 합성 데이터 · 격리된 임시 프로필 · 로컬 빌드만 쓴다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/quiet-ui-results/check/quiet-ui.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve(process.env.OUT ?? 'docs/development/quiet-ui-results')
mkdirSync(OUT, { recursive: true })

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
const at = (id, k, seconds, note) => ({
  id,
  source: 'youtube',
  videoId: lists[0].tracks[k].videoId,
  atSeconds: seconds,
  note,
  title: lists[0].tracks[k].title,
  createdAt: `2026-11-21T0${String(k)}:00:00.000Z`,
  updatedAt: `2026-11-21T0${String(k)}:00:00.000Z`,
})
// 한 곡에 순간이 많아도 오른쪽 칸이 칸 높이를 다 쓰는지 본다.
const moments = {
  version: 1,
  data: [
    ...Array.from({ length: 12 }, (_, i) =>
      at(`a${String(i)}`, 0, 10 + i * 15, i % 3 === 0 ? '' : `메모 ${String(i + 1)}`),
    ),
    at('b0', 1, 40, '도입부 기타'),
    at('b1', 1, 150, '두 번째 후렴'),
    at('c0', 2, 30, '빗소리'),
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
  const text = (selector) =>
    ev(
      `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`,
    )

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
  await sleep(500)

  // 1. 대시보드 — 설명 글 · "보관함에서 편집" · 카세트 머리 글이 없다.
  const dash = await ev(`(() => {
    const body = document.body.innerText
    const svgText = [...document.querySelectorAll('.deck-art--kawaii-synth-cassette text')].map((t) => t.textContent.trim())
    return {
      hint: !!document.querySelector('.deck-hint'),
      editButton: !!document.querySelector('.now-playlist .open-archive'),
      captureHint: !!document.querySelector('#dashboard-moment-capture-hint'),
      muteNote: !!document.querySelector('.mute-note'),
      placeholder: document.querySelector('.video-placeholder')?.innerText.trim(),
      sub: document.querySelector('.now-sub')?.innerText.trim(),
      svgText,
      phrases: ['카세트를 누르면', '곡을 누르면 그 곡부터', '보관함에서 편집', '지금 시점을 잡아요', '16:9로 표시', '그대로 표시됩니다', '링크를 추가할 수 있어요'].filter((w) => body.includes(w)),
    }
  })()`)
  record(
    '대시보드: 설명 글 · 보관함에서 편집 · 카세트 머리 글(SYNTH / CASSETTE) 없음',
    !dash.hint &&
      !dash.editButton &&
      !dash.captureHint &&
      !dash.muteNote &&
      dash.placeholder === 'YOUTUBE / VIDEO' &&
      dash.sub === '' &&
      !dash.svgText.some((t) => t.includes('SYNTH / CASSETTE') || t.includes('DIGITAL MIX TAPE')) &&
      dash.phrases.length === 0,
    dash,
  )
  await shot('dashboard-1440')

  // 2. 카세트 → 보관함이 고른 목록의 곡으로 · 닫기는 × 아이콘만 · 바닥 안내 없음.
  await click('.deck-open--kawaii-synth-cassette')
  await waitFor(() => ev(`document.querySelector('#archive-panel')?.hidden === false`), {
    label: 'archive',
  })
  await sleep(400)
  const music = await ev(`(() => {
    const close = document.querySelector('.strip-close')
    const icon = close?.querySelector('.ui-icon')
    const rowIcons = [...document.querySelectorAll('.track')[0].querySelectorAll('.track-icons button')]
    const listIcons = [...document.querySelector('.list-row').querySelectorAll('.list-icons button')]
    const archiveText = document.querySelector('#archive-panel').innerText
    return {
      title: document.querySelector('#playlist-editor-title')?.textContent.trim(),
      closeText: close?.innerText.trim(),
      closeLabel: close?.getAttribute('aria-label'),
      iconMask: icon ? getComputedStyle(icon).maskImage || getComputedStyle(icon).webkitMaskImage : null,
      iconSize: icon ? [icon.getBoundingClientRect().width, icon.getBoundingClientRect().height] : null,
      rowIcons: rowIcons.map((b) => [b.getAttribute('aria-label'), b.innerText.trim(), b.getBoundingClientRect().width]),
      listIcons: listIcons.map((b) => b.getAttribute('aria-label')),
      manage: [...document.querySelectorAll('#archive-panel button')].filter((b) => b.innerText.trim() === '관리').length,
      foot: !!document.querySelector('.archive-foot'),
      words: ['Esc 또는', 'YOUTUBE ONLY', 'TRACKS', '보관함 › 음악'].filter((w) => archiveText.includes(w)),
    }
  })()`)
  record(
    '카세트 → 고른 목록의 곡 · × 아이콘 닫기 · 관리 단추 · 바닥 안내 없음',
    music.title === '여름 밤 플레이리스트' &&
      music.closeText === '' &&
      music.closeLabel === '보관함 닫기' &&
      String(music.iconMask).includes('data:image/svg+xml') &&
      music.iconSize?.[0] === 18 &&
      music.manage === 0 &&
      !music.foot &&
      music.words.length === 0,
    music,
  )
  record(
    '곡 행: 연필 · 앨범아트 · 공유 · 휴지통 아이콘(글자 없음, 40px) · 목록 행: 연필 · 공유 · 휴지통',
    JSON.stringify(music.rowIcons.map((r) => r[0])) ===
      JSON.stringify([
        '아이유 - 밤편지 (Through the Night) MV 이름 변경',
        '아이유 - 밤편지 (Through the Night) MV 앨범아트 설정',
        '아이유 - 밤편지 (Through the Night) MV 공유',
        '아이유 - 밤편지 (Through the Night) MV 삭제',
      ]) &&
      music.rowIcons.every((r) => r[1] === '' && r[2] === 40) &&
      JSON.stringify(music.listIcons) ===
        JSON.stringify([
          '여름 밤 플레이리스트 이름 수정',
          '여름 밤 플레이리스트 목록 공유',
          '여름 밤 플레이리스트 삭제',
        ]),
    music,
  )
  await shot('archive-music-1440')

  // 3. 곡 아이콘이 실제로 동작한다 — 연필 · 휴지통(확인 · 취소) · 공유.
  const title = lists[0].tracks[1].title
  await click(`button[aria-label=${JSON.stringify(`${title} 이름 변경`)}]`)
  const renameOpen = await ev(`!!document.querySelector('.rename-form input')`)
  await click(`button[aria-label=${JSON.stringify(`${title} 이름 변경`)}]`)
  const renameClosed = await ev(`!document.querySelector('.rename-form')`)
  await click(`button[aria-label=${JSON.stringify(`${title} 삭제`)}]`)
  const confirm = await text('[aria-label="트랙 삭제 확인"] .confirm-text')
  await ev(
    `[...document.querySelectorAll('[aria-label="트랙 삭제 확인"] button')].find((b) => b.textContent.trim() === '취소').click(); true`,
  )
  await sleep(200)
  await click(`button[aria-label=${JSON.stringify(`${title} 공유`)}]`)
  await waitFor(() => ev(`!!document.querySelector('.share-dialog')`), { label: 'share' })
  const shareTarget = await ev(
    `[document.querySelector('.share-dialog .target-kind')?.textContent, document.querySelector('.share-dialog .target-name')?.textContent]`,
  )
  await ev(`document.querySelector('[aria-label="공유 닫기"]').click(); true`)
  await sleep(300)
  const tracksAfter = await ev(
    `JSON.parse(localStorage.getItem('39page.library')).data.playlists[0].tracks.length`,
  )
  record(
    '곡 아이콘: 연필은 이름 폼 토글 · 휴지통은 그 자리 확인(취소하면 그대로) · 공유는 그 곡',
    renameOpen &&
      renameClosed &&
      confirm.includes(title) &&
      tracksAfter === 3 &&
      shareTarget[0] === '곡' &&
      shareTarget[1] === title,
    { renameOpen, renameClosed, confirm, tracksAfter, shareTarget },
  )
  await click('.music-detail .edit-toggle')
  const reorder = await ev(`(() => ({
    pressed: document.querySelector('.edit-toggle').getAttribute('aria-pressed'),
    up: document.querySelectorAll('.edit-actions .edit-up').length,
    icons: document.querySelectorAll('.track-icons').length,
  }))()`)
  await shot('archive-reorder-1440')
  await click('.music-detail .edit-toggle')
  record(
    '순서 모드(⇅): 행마다 ↑ · ↓ 만, 행 아이콘은 숨는다',
    reorder.pressed === 'true' && reorder.up === 3 && reorder.icons === 0,
    reorder,
  )

  // 4. Moments — 두 칸. 왼쪽 보기 · 곡, 오른쪽 순간이 칸 높이를 쓴다.
  await click('#archive-tab-moments')
  await sleep(400)
  await click(`.song-item[data-song="${lists[0].tracks[0].videoId}"]`)
  await sleep(300)
  const panes = await ev(`(() => {
    const nav = document.querySelector('.moments-nav').getBoundingClientRect()
    const detail = document.querySelector('.moments-detail')
    const d = detail.getBoundingClientRect()
    const rows = [...detail.querySelectorAll('.moment-item')]
    const first = rows[0]?.getBoundingClientRect()
    return {
      side: nav.right <= d.left + 1 && Math.abs(nav.top - d.top) < 2,
      navWidth: Math.round(nav.width),
      detailHeight: Math.round(d.height),
      firstRowTop: first ? Math.round(first.top - d.top) : null,
      visibleRows: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom <= d.bottom && b.top >= d.top }).length,
      title: detail.querySelector('.detail-title')?.textContent.trim(),
      meta: detail.querySelector('.detail-meta')?.textContent.trim(),
      views: [...document.querySelectorAll('.view-item')].map((v) => v.dataset.view),
      songs: [...document.querySelectorAll('.song-item')].map((s) => s.innerText.replace(/\\s+/g, ' ').trim()),
      selected: document.querySelector('.song-item[aria-current="true"]')?.dataset.song,
      icons: [...(rows[0]?.querySelectorAll('.moment-icons button') ?? [])].map((b) => b.getAttribute('title')),
      manage: !!detail.querySelector('[data-moment-manage]'),
      words: ['순간만 보는 중', '이 곡 · Moments'].filter((w) => document.querySelector('#archive-panel-moments').innerText.includes(w)),
    }
  })()`)
  record(
    'Moments 두 칸: 왼쪽 보기 · 곡 목록, 오른쪽 그 곡의 순간 — 목록이 칸 위쪽부터 여러 줄 보인다',
    panes.side &&
      panes.title === lists[0].tracks[0].title &&
      panes.meta === '12개' &&
      panes.selected === lists[0].tracks[0].videoId &&
      panes.songs.length === 3 &&
      panes.firstRowTop !== null &&
      panes.firstRowTop < 120 &&
      panes.visibleRows >= 6 &&
      JSON.stringify(panes.icons) === JSON.stringify(['메모 수정', '공유', '삭제']) &&
      !panes.manage &&
      panes.words.length === 0,
    panes,
  )
  await shot('archive-moments-1440')

  // 5. Moment 아이콘 — 연필 · 공유 · 휴지통.
  await click('[data-moment-edit="a1"]')
  const momentEdit = await ev(`document.activeElement?.id`)
  await ev(
    `[...document.querySelectorAll('.edit-form button')].find((b) => b.textContent.trim() === '취소').click(); true`,
  )
  await sleep(200)
  const backToPencil = await ev(`document.activeElement?.dataset.momentEdit`)
  await click('[data-moment-remove="a1"]')
  const momentConfirm = await ev(`!!document.querySelector('.moments-detail [role="alertdialog"]')`)
  await click('[data-moment-remove="a1"]')
  const momentConfirmClosed = await ev(
    `!document.querySelector('.moments-detail [role="alertdialog"]')`,
  )
  await click('[data-moment-share="a1"]')
  await waitFor(() => ev(`!!document.querySelector('.share-dialog')`), { label: 'moment share' })
  const momentShare = await ev(
    `[document.querySelector('.share-dialog .target-kind')?.textContent, document.querySelector('.share-dialog .target-detail')?.textContent]`,
  )
  await ev(`document.querySelector('[aria-label="공유 닫기"]').click(); true`)
  await sleep(300)
  record(
    'Moment 아이콘: 연필은 메모 칸(취소하면 연필로) · 휴지통은 확인 토글 · 공유는 그 순간',
    momentEdit === 'archive-moment-note-a1' &&
      backToPencil === 'a1' &&
      momentConfirm &&
      momentConfirmClosed &&
      momentShare[0] === 'Moment' &&
      momentShare[1] === '0:25',
    { momentEdit, backToPencil, momentConfirm, momentConfirmClosed, momentShare },
  )

  // 6. 검색 — 전체로 가서 맞는 곡만 왼쪽에 남고, 곡을 고르면 그 곡의 맞는 순간만.
  await ev(`(() => {
    const input = document.querySelector('#archive-moments-search')
    input.value = '후렴'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
  const searched = await ev(`(() => ({
    view: document.querySelector('.view-item[aria-current="true"]')?.dataset.view,
    songs: [...document.querySelectorAll('.song-item')].map((s) => s.dataset.song),
    summary: document.querySelector('#archive-moments-summary')?.textContent.trim(),
  }))()`)
  await ev(
    `(() => { const i = document.querySelector('#archive-moments-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
  )
  await sleep(300)
  record(
    '검색: 전체 보기로 가고, 왼쪽에는 맞는 곡만 남는다',
    searched.view === 'all' &&
      JSON.stringify(searched.songs) === JSON.stringify([lists[0].tracks[1].videoId]) &&
      searched.summary === '순간 1개 · 곡 1개',
    searched,
  )

  // 7. 좁은 화면 — 한 번에 한 칸. ‹ 로 곡 목록, 곡을 고르면 순간. 가로로 넘치지 않는다.
  await ev(`document.querySelector('[aria-label="보관함 닫기"]:not([hidden])')?.click(); true`)
  await size(390, 844)
  await sleep(500)
  await ev(`document.querySelector('.app-nav button').click(); true`)
  await sleep(400)
  await ev(`document.querySelector('#archive-tab-moments').click(); true`)
  await sleep(400)
  const narrow = async () =>
    ev(`(() => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' }
      return {
        step: document.querySelector('.moments-browser')?.dataset.step,
        nav: shown('.moments-nav'),
        detail: shown('.moments-detail'),
        back: shown('.back-to-nav'),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      }
    })()`)
  const n1 = await narrow()
  await click('.back-to-nav')
  const n2 = await narrow()
  await shot('moments-nav-390')
  await click(`.song-item[data-song="${lists[0].tracks[2].videoId}"]`)
  const n3 = await narrow()
  const n3title = await text('.moments-detail .detail-title')
  await shot('moments-detail-390')
  record(
    '390px: 한 번에 한 칸 — ‹ 로 곡 목록, 곡을 고르면 그 순간 · 가로 넘침 없음',
    n1.detail &&
      !n1.nav &&
      n1.back &&
      n2.nav &&
      !n2.detail &&
      n3.detail &&
      !n3.nav &&
      n3title === lists[0].tracks[2].title &&
      ![n1, n2, n3].some((n) => n.overflow),
    { n1, n2, n3, n3title },
  )

  // 8. 좁은 화면의 곡 행 — 아이콘이 제목 아래 줄로 내려가 제목이 눌리지 않는다.
  await ev(`document.querySelector('#archive-tab-music').click(); true`)
  await sleep(300)
  await ev(`document.querySelector('.list-select[aria-current="true"]')?.click(); true`)
  await sleep(400)
  const rowLayout = await ev(`(() => {
    const row = document.querySelector('.track')
    const name = row.querySelector('.track-name').getBoundingClientRect()
    const icons = row.querySelector('.track-icons').getBoundingClientRect()
    return {
      nameWidth: Math.round(name.width),
      iconsBelow: icons.top >= name.bottom - 2,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }
  })()`)
  await shot('music-detail-390')
  record(
    '390px 곡 행: 아이콘은 아래 줄 · 제목 폭이 넉넉하다 · 가로 넘침 없음',
    rowLayout.iconsBelow && rowLayout.nameWidth > 150 && !rowLayout.overflow,
    rowLayout,
  )

  // 9. Mono 테마에서도 같은 아이콘 — 테마 토큰 색.
  await ev(`document.querySelector('[aria-label="보관함 닫기"]:not([hidden])')?.click(); true`)
  await size(1440, 900)
  await sleep(300)
  await ev(
    `[...document.querySelectorAll('.theme-switch button')].find((b) => b.textContent.toLowerCase().includes('mono'))?.click(); true`,
  )
  await waitFor(() => ev(`document.documentElement.dataset.theme === 'mono-vinyl'`), {
    label: 'mono',
  })
  await sleep(300)
  await click('.deck-open--mono-vinyl')
  await sleep(500)
  const mono = await ev(`(() => {
    const b = document.querySelector('.track-icons button')
    const i = b.querySelector('.ui-icon')
    return { color: getComputedStyle(i).backgroundColor, text: b.innerText.trim() }
  })()`)
  await shot('archive-music-mono-1440')
  record(
    'Mono: 같은 아이콘이 테마 색으로',
    mono.text === '' && mono.color !== 'rgba(0, 0, 0, 0)',
    mono,
  )
} finally {
  writeFileSync(
    path.join(OUT, 'real-chrome-quiet-ui.json'),
    `${JSON.stringify({ date: new Date().toISOString(), results }, null, 2)}\n`,
  )
  await h.kill()
}
const failed = results.filter((r) => !r.pass).length
console.log(`${String(results.length - failed)}/${String(results.length)} passed`)
process.exit(failed === 0 ? 0 : 1)
