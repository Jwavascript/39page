// ADR 0040 — 링크로 공유 실제 Chrome 확인. 보내는 사람(A)과 받는 사람(B · C · D · E)은 **서로 다른 브라우저 컨텍스트**다 —
// 저장소(localStorage · IndexedDB)를 나누지 않는다. 다른 사람이 링크를 여는 것과 같다.
// 로컬 프로덕션 빌드(127.0.0.1:4173)와 격리된 임시 Chrome 프로필만 쓴다. 운영 39page 에 닿지 않는다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/share-link-results/check/sharelink.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/share-link-results')
mkdirSync(OUT, { recursive: true })

const V = { bunny: 'aqz-KE-bpKQ', sintel: 'eRsGyueVLvQ', demo: 'M7lc1UVf-VE' }
/** 실제 영상 ID 처럼 무작위로 보이는 11자 (정해진 순서) — 연속 번호는 압축이 너무 잘 돼 길이를 속인다. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// mulberry32 — 아래쪽 비트도 고르게 섞인다 (단순 LCG 의 아래 6비트는 64개마다 되풀이돼 압축이 너무 잘 된다).
let state = 20261120
const random = () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randomId = () =>
  Array.from({ length: 11 }, () => ALPHABET[Math.floor(random() * 64)]).join('')
const big = Array.from({ length: 50 }, (_, i) => ({
  id: `b${String(i)}`,
  source: 'youtube',
  videoId: randomId(),
  // 겹치지 않는 한글 제목 — 압축으로 줄지 않는 실제 제목들처럼.
  title: Array.from({ length: 18 }, (_, k) =>
    String.fromCharCode(0xac00 + ((i * 7919 + k * 104729) % 11172)),
  ).join(''),
}))
const seed = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'a',
        name: '여름 밤 플레이리스트',
        tracks: [
          { id: 'a1', source: 'youtube', videoId: V.bunny, title: '버니 — 테스트 곡' },
          { id: 'a2', source: 'youtube', videoId: V.sintel, title: 'Sintel 2010' },
          { id: 'a3', source: 'youtube', videoId: V.demo, title: 'API 데모' },
        ],
      },
      { id: 'big', name: '50곡 목록', tracks: big },
    ],
    selectedPlaylistId: 'a',
  },
}
const moments = {
  version: 1,
  data: [
    {
      id: 'm1',
      source: 'youtube',
      videoId: V.sintel,
      atSeconds: 120,
      note: '여기부터 최고\n두 번째 줄',
      title: 'Sintel 2010',
      createdAt: '2026-11-20T01:00:00.000Z',
      updatedAt: '2026-11-20T01:00:00.000Z',
    },
  ],
}

const results = []
const lengths = {}
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 500))
}

/** 한 탭(세션)을 다루는 도구. */
function pageTools(h, session) {
  const ev = (expression) => h.cdp.evaluate(session, expression)
  const send = (method, params = {}) => h.cdp.send(method, params, session)
  const click = async (selector, text) => {
    const point = await ev(
      `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${JSON.stringify(text ?? null)} === null || x.textContent.trim() === ${JSON.stringify(text ?? '')}); if (!e) throw Error('no element ' + ${JSON.stringify(`${selector} ${text ?? ''}`)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    await sleep(300)
  }
  const size = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768,
    })
  const shot = async (selector, name) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    const box = await ev(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: Math.min(r.height, innerHeight) } })()`,
    )
    await sleep(300)
    const image = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...box, scale: 1 },
    })
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(image.data, 'base64'))
  }
  /** YouTube 공식 API(`YT.get`)가 아는 플레이어 상태. */
  const player = () =>
    ev(
      `(() => { const f = document.querySelector('.player-mount iframe'); let p = null; try { p = f && f.id && window.YT && YT.get ? YT.get(f.id) : null } catch {} return { video: p?.getVideoData?.()?.video_id ?? null, state: typeof p?.getPlayerState === 'function' ? p.getPlayerState() : null, time: typeof p?.getCurrentTime === 'function' ? p.getCurrentTime() : null } })()`,
    )
  return { ev, send, click, size, shot, player }
}

/** 새 브라우저 컨텍스트(다른 사람)에서 링크를 연다. */
async function openAsSomeoneElse(h, url) {
  const { browserContextId } = await h.cdp.send('Target.createBrowserContext', {})
  const { targetId } = await h.cdp.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  })
  const session = await h.cdp.attach(targetId)
  await h.cdp.send('Runtime.enable', {}, session)
  const tools = pageTools(h, session)
  await tools.size(1440, 900)
  await tools.send('Network.enable')
  await tools.send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
  await tools.send('Page.navigate', { url })
  return { ...tools, browserContextId, targetId }
}

const DIALOG = `(() => { const d = document.querySelector('.share-link-dialog'); if (!d) return null; return { kicker: d.querySelector('.kicker')?.textContent.trim() ?? null, headline: d.querySelector('.headline, .error-title')?.textContent.trim() ?? null, meta: d.querySelector('.meta')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, rows: [...d.querySelectorAll('.tracks .title')].map((e) => e.textContent.trim()), moments: [...d.querySelectorAll('.moments li')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()), error: d.querySelector('.error-text')?.textContent.trim() ?? null, lookup: d.querySelector('.lookup')?.textContent.trim() ?? null } })()`

async function main() {
  const h = await launch({
    chrome: process.env.POC_CHROME,
    webDist: path.resolve('dist'),
    headful: false,
  })
  try {
    /* ---------- 보내는 사람 A ---------- */
    const pa = await h.tab('about:blank')
    const A = pageTools(h, pa.session)
    await A.send('Network.enable')
    await A.send('Network.setBlockedURLs', { urls: ['*open-meteo*'] })
    await A.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await h.cdp.send('Browser.grantPermissions', {
      origin: BASE,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
    await A.size(1440, 900)
    await A.send('Page.navigate', { url: BASE })
    await waitFor(() => A.ev(`!!document.querySelector('.now-playlist')`), { label: 'A app' })
    await A.ev(
      `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); localStorage.setItem('39page.moments', ${JSON.stringify(JSON.stringify(moments))}); true`,
    )
    await A.ev(`window.__old = true; true`)
    await A.send('Page.reload')
    await waitFor(
      () => A.ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`),
      { label: 'A seeded' },
    )

    // 보관함 → 목록 관리 → 이 목록 공유
    await A.click('.app-nav button')
    await waitFor(() => A.ev(`!!document.querySelector('.archive-lists .list-manage')`), {
      label: 'archive',
    })
    await A.click('.archive-lists .list-manage')
    await A.click('.archive-lists .manage-panel button', '이 목록 공유')
    await waitFor(() => A.ev(`!!document.querySelector('.link-share .link-field')?.value`), {
      label: 'link',
    })
    const playlistLink = await A.ev(`document.querySelector('.link-share .link-field').value`)
    lengths.playlistWithTitles = playlistLink.length
    await A.click('.link-share .copy')
    await sleep(300)
    const copyStatus = await A.ev(
      `document.querySelector('.link-share .copy-status')?.textContent.trim()`,
    )
    let clipboard = null
    try {
      clipboard = await A.ev(`navigator.clipboard.readText()`)
    } catch (error) {
      clipboard = `읽기 실패: ${error.message}`
    }
    record(
      'A: 목록 공유 링크를 만들고 "링크 복사" 로 클립보드에 넣는다',
      playlistLink.startsWith(`${BASE}/#share?v=1&d=`) &&
        copyStatus === '링크를 복사했어요.' &&
        clipboard === playlistLink,
      {
        length: playlistLink.length,
        copyStatus,
        clipboardMatches: clipboard === playlistLink,
      },
    )
    await A.shot('.link-share', 'sender-link-box-1440')

    // 곡 이름 빼기 → 짧은 링크
    await A.click('.link-share label.check', '곡 이름 넣기')
    const titlelessLink = await A.ev(`document.querySelector('.link-share .link-field').value`)
    lengths.playlistWithoutTitles = titlelessLink.length
    await A.click('.link-share label.check', '곡 이름 넣기')

    // 50곡 목록의 길이 · 경고
    await A.ev(
      `(() => { const s = document.querySelector('.share select'); s.value = 'big'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`,
    )
    await sleep(300)
    const bigInfo = await A.ev(
      `({ link: document.querySelector('.link-share .link-field').value.length, warn: document.querySelector('.link-share .warn')?.textContent.replace(/\\s+/g, ' ').trim() ?? null })`,
    )
    await A.click('.link-share label.check', '곡 이름 넣기')
    const bigNoTitles = await A.ev(`document.querySelector('.link-share .link-field').value.length`)
    lengths.big50WithTitles = bigInfo.link
    lengths.big50WithoutTitles = bigNoTitles
    record(
      'A: 50곡(겹치지 않는 한글 제목)은 "잘릴 수 있어요" 와 곡 이름을 뺀 길이를 알린다',
      bigInfo.warn !== null &&
        bigInfo.warn.includes('잘릴 수 있어요') &&
        bigNoTitles < bigInfo.link,
      { ...bigInfo, withoutTitles: bigNoTitles },
    )
    await A.size(390, 844)
    await sleep(400)
    const senderOverflow = await A.ev(
      `document.querySelector('#data-dialog').scrollWidth > document.querySelector('#data-dialog').clientWidth + 1`,
    )
    await A.shot('.link-share', 'sender-link-box-390')
    await A.size(1440, 900)
    await A.ev(`document.querySelector('[aria-label="데이터 닫기"]')?.click(); true`)
    await sleep(300)

    /* ---------- 받는 사람 B — 목록, 곡 이름 있음 ---------- */
    const B = await openAsSomeoneElse(h, playlistLink)
    await waitFor(() => B.ev(`!!document.querySelector('.share-link-dialog .headline')`), {
      label: 'B dialog',
      timeout: 20_000,
    })
    const bDialog = await B.ev(DIALOG)
    const bBefore = await B.ev(
      `JSON.parse(localStorage.getItem('39page.library') ?? 'null')?.data?.playlists?.map((p) => p.name) ?? []`,
    )
    record(
      'B(다른 사람): 링크를 열면 미리보기 — 목록 이름 · 곡 이름 · 아직 저장 안 함',
      bDialog?.headline === '여름 밤 플레이리스트' &&
        bDialog.rows.join('|') === '버니 — 테스트 곡|Sintel 2010|API 데모' &&
        !bBefore.includes('여름 밤 플레이리스트'),
      { dialog: bDialog, libraryBefore: bBefore },
    )
    await B.shot('.share-link-dialog', 'receiver-dialog-1440')
    await B.click('.share-link-dialog button', '보관함에 추가하고 듣기')
    await waitFor(
      async () => {
        const p = await B.player()
        return p.state === 1 && p.video === V.bunny ? p : null
      },
      { label: 'B playing', timeout: 30_000 },
    )
    const bAfter = await B.ev(
      `({ hash: location.hash, lists: JSON.parse(localStorage.getItem('39page.library')).data.playlists.map((p) => ({ name: p.name, titles: p.tracks.map((t) => t.title) })), nowList: document.querySelector('.now-playlist .list-name')?.textContent.trim(), dialog: !!document.querySelector('.share-link-dialog') })`,
    )
    const imported = bAfter.lists.find((l) => l.name === '여름 밤 플레이리스트')
    record(
      'B: "보관함에 추가하고 듣기" → B 의 보관함에 저장 · 첫 곡 재생(실제 YouTube) · 조각 지움',
      imported?.titles.join('|') === '버니 — 테스트 곡|Sintel 2010|API 데모' &&
        bAfter.hash === '' &&
        !bAfter.dialog &&
        bAfter.nowList === '여름 밤 플레이리스트',
      bAfter,
    )
    const aLists = await A.ev(
      `JSON.parse(localStorage.getItem('39page.library')).data.playlists.map((p) => p.name)`,
    )
    record(
      'A 의 보관함은 그대로다 (컨텍스트가 다르다)',
      aLists.join('|') === '여름 밤 플레이리스트|50곡 목록',
      { aLists },
    )

    /* ---------- 받는 사람 C — 곡 이름 없는 짧은 링크 ---------- */
    const C = await openAsSomeoneElse(h, titlelessLink)
    await waitFor(() => C.ev(`!!document.querySelector('.share-link-dialog .headline')`), {
      label: 'C dialog',
      timeout: 20_000,
    })
    const cDialog = await waitFor(
      async () => {
        const d = await C.ev(DIALOG)
        return d !== null && d.lookup === null && d.rows.every((r) => !r.startsWith('YouTube ·'))
          ? d
          : null
      },
      { label: 'C titles', timeout: 20_000 },
    ).catch(async () => C.ev(DIALOG))
    record(
      'C: 곡 이름을 뺀 링크 — YouTube(oEmbed)에서 실제 제목을 찾아 보인다',
      cDialog !== null &&
        cDialog.rows.length === 3 &&
        cDialog.rows.every((r) => !r.startsWith('YouTube ·')),
      {
        rows: cDialog?.rows,
        shorterBy: lengths.playlistWithTitles - lengths.playlistWithoutTitles,
      },
    )

    /* ---------- A → Moment 링크 → D ---------- */
    if (await A.ev(`document.querySelector('#archive-panel')?.hidden !== false`)) {
      await A.click('.app-nav button')
      await sleep(300)
    }
    await A.click('#archive-tab-moments')
    await waitFor(() => A.ev(`!!document.querySelector('[data-moment-manage="m1"]')`), {
      label: 'moments tab',
    })
    await A.click('[data-moment-manage="m1"]')
    await A.click('[data-moment-share="m1"]')
    await waitFor(() => A.ev(`!!document.querySelector('.moment-target')`), {
      label: 'moment share',
    })
    await A.click('.link-share label.check', 'Moment 메모 넣기')
    const momentLink = await A.ev(`document.querySelector('.link-share .link-field').value`)
    lengths.momentWithNote = momentLink.length
    const D = await openAsSomeoneElse(h, momentLink)
    await waitFor(() => D.ev(`!!document.querySelector('.share-link-dialog .headline')`), {
      label: 'D dialog',
      timeout: 20_000,
    })
    const dDialog = await D.ev(DIALOG)
    await D.click('.share-link-dialog button', '그 순간부터 듣기')
    const dPlay = await waitFor(
      async () => {
        const p = await D.player()
        return p.state === 1 && p.video === V.sintel && p.time !== null && p.time >= 119 ? p : null
      },
      { label: 'D playing at moment', timeout: 30_000 },
    )
    const dSaved = await D.ev(`localStorage.getItem('39page.moments')`)
    record(
      'D: Moment 링크 — 미리보기(시점 · 메모) · "그 순간부터 듣기" 는 저장 없이 120초부터 재생',
      dDialog?.meta?.includes('2:00 부터') &&
        dDialog.moments.join(' ').includes('여기부터 최고') &&
        dPlay.time >= 119 &&
        dSaved === null,
      { dialog: dDialog, time: dPlay.time, savedMoments: dSaved },
    )

    /* ---------- 이미 열린 탭(B)에 링크 붙여 넣기 — hashchange ---------- */
    await B.ev(`location.hash = ${JSON.stringify(momentLink.slice(momentLink.indexOf('#')))}; true`)
    await waitFor(() => B.ev(`!!document.querySelector('.share-link-dialog .headline')`), {
      label: 'B hashchange dialog',
      timeout: 10_000,
    })
    const bHash = await B.ev(DIALOG)
    await B.click('.share-link-dialog button', 'Moment 저장')
    await sleep(400)
    const bMoments = await B.ev(
      `JSON.parse(localStorage.getItem('39page.moments')).data.map((m) => [m.videoId, m.atSeconds, m.note])`,
    )
    record(
      'B: 열린 탭에 링크를 붙여 넣어도 미리보기 · "Moment 저장" 은 그 Moment 만 저장',
      bHash?.kicker === '공유받은 순간' &&
        bMoments.length === 1 &&
        bMoments[0][1] === 120 &&
        bMoments[0][2].startsWith('여기부터 최고'),
      { bMoments },
    )
    await B.click('.share-link-dialog button', '닫기')

    /* ---------- E — 잘린 링크 ---------- */
    const E = await openAsSomeoneElse(h, playlistLink.slice(0, playlistLink.length - 15))
    await waitFor(() => E.ev(`!!document.querySelector('.share-link-dialog .error-title')`), {
      label: 'E error',
      timeout: 20_000,
    })
    const eDialog = await E.ev(DIALOG)
    const eLists = await E.ev(
      `JSON.parse(localStorage.getItem('39page.library') ?? 'null')?.data?.playlists?.map((p) => p.name) ?? []`,
    )
    record(
      'E: 게시판이 끝을 자른 링크 — 이유와 할 일을 말하고 아무것도 저장하지 않는다',
      eDialog?.headline === '공유 링크를 열 수 없어요' &&
        (eDialog.error ?? '').includes('다시 받아') &&
        !eLists.includes('여름 밤 플레이리스트'),
      { dialog: eDialog },
    )

    /* ---------- 배치 — 받는 쪽 대화상자 390 · 320 ---------- */
    const layout = []
    const F = await openAsSomeoneElse(h, playlistLink)
    for (const [w, hh] of [
      [1440, 900],
      [390, 844],
      [320, 640],
    ]) {
      await F.size(w, hh)
      await waitFor(() => F.ev(`!!document.querySelector('.share-link-dialog .headline')`), {
        label: 'F dialog',
        timeout: 20_000,
      })
      await sleep(400)
      const m = await F.ev(
        `(() => { const d = document.querySelector('.share-link-dialog'); const r = d.getBoundingClientRect(); const btns = [...d.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return { inside: r.left >= -0.5 && r.right <= innerWidth + 0.5, overflowX: d.scrollWidth > d.clientWidth + 1, pageOverflow: document.scrollingElement.scrollWidth > innerWidth, minButton: Math.min(...btns.map((b) => Math.min(b.width, b.height))) } })()`,
      )
      layout.push({ width: w, ...m })
      if (w !== 1440) await F.shot('.share-link-dialog', `receiver-dialog-${w}`)
    }
    record(
      '받는 쪽 대화상자 배치 — 1440 · 390 · 320 화면 안 · 가로 넘침 없음 · 단추 44px · 보내는 쪽 390 넘침 없음',
      layout.every((x) => x.inside && !x.overflowX && !x.pageOverflow && x.minButton >= 43.5) &&
        !senderOverflow,
      { layout, senderOverflow },
    )
  } finally {
    h.cdp.close()
    h.kill()
    await sleep(1500)
  }
}

try {
  await main()
} catch (error) {
  record('실행 오류', false, { error: error.message })
}
const passed = results.filter((r) => r.pass).length
writeFileSync(
  path.join(OUT, 'real-chrome-sharelink.json'),
  `${JSON.stringify({ when: new Date().toISOString(), passed, total: results.length, lengths, results }, null, 2)}\n`,
)
console.log('lengths', JSON.stringify(lengths))
console.log(`${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
