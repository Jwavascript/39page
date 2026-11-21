// "YouTube에서 검색" 실제 Chrome 확인 — 검색 결과 페이지가 새 탭(noopener)으로 열리고, 링크 추가는 제출되지 않는다.
// 로컬 프로덕션 빌드(127.0.0.1:4173)와 격리된 임시 Chrome 프로필만 쓴다. 운영 39page 에 닿지 않는다.
// 실행: npm run build && POC_CHROME=<chrome.exe> node docs/development/playback-ux-results/check/search.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { launch, BASE, sleep, waitFor } from '../../../../extension/integration/harness.mjs'

const OUT = path.resolve('docs/development/playback-ux-results')
mkdirSync(OUT, { recursive: true })

const seed = {
  version: 1,
  data: {
    playlists: [
      {
        id: 'a',
        name: 'LIST A',
        tracks: [{ id: 'a1', source: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'A1 Bunny' }],
      },
    ],
    selectedPlaylistId: 'a',
  },
}

const results = []
function record(name, pass, details = {}) {
  results.push({ name, pass: Boolean(pass), details })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(details).slice(0, 500))
}

async function main() {
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
      `localStorage.setItem('39page.library', ${JSON.stringify(JSON.stringify(seed))}); true`,
    )
    await ev(`window.__old = true; true`)
    await send('Page.reload')
    await waitFor(
      () => ev(`!window.__old && !!document.querySelector('.now-playlist .track-row')`),
      {
        label: 'seeded app',
      },
    )

    const click = async (selector, text) => {
      const point = await ev(
        `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${JSON.stringify(text ?? null)} === null || x.textContent.trim() === ${JSON.stringify(text ?? '')}); if (!e) throw Error('no element ' + ${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
      )
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
      await sleep(250)
    }
    const typeInto = async (selector, text) => {
      await click(selector)
      await send('Input.insertText', { text })
      await sleep(150)
    }
    const pressEnter = async () => {
      for (const type of ['keyDown', 'keyUp'])
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          ...(type === 'keyDown' ? { text: '\r' } : {}),
        })
      await sleep(300)
    }
    const pages = async () => (await h.cdp.targets()).filter((t) => t.type === 'page')

    // 보관함의 링크 추가 양식을 연다.
    // ADR 0044 — "보관함에서 편집" 이 없어졌다. 데크(보이는 테마의 열기 단추)로 연다.
    await ev(
      `[...document.querySelectorAll('.deck-open')].find((e) => e.offsetParent !== null)?.click(); true`,
    )
    await waitFor(() => ev(`!!document.querySelector('.playlist-editor')`), { label: 'archive' })
    await click('.playlist-editor .head-actions .pill', '＋ YouTube 링크 추가')
    await waitFor(() => ev(`!!document.querySelector('#yt-search-query')`), {
      label: 'search form',
    })
    const focused = await ev(`document.activeElement?.id`)

    /* 1. 검색어 + Enter → 새 탭에 검색 결과 */
    const before = (await pages()).map((t) => t.targetId)
    await typeInto('#yt-search-query', '아이유 밤편지')
    await pressEnter()
    const opened = await waitFor(
      async () =>
        (await pages()).find((t) => !before.includes(t.targetId) && t.url.includes('youtube.com')),
      { label: 'search tab', timeout: 15_000 },
    )
    const url = new URL(opened.url)
    const session = await h.cdp.attach(opened.targetId)
    await h.cdp.send('Runtime.enable', {}, session)
    const opener = await h.cdp.evaluate(session, `window.opener === null`)
    const after = await ev(`({
      tracks: JSON.parse(localStorage.getItem('39page.library')).data.playlists[0].tracks.length,
      error: document.querySelector('#track-url-error')?.textContent.trim(),
      formOpen: !!document.querySelector('form.link-form'),
    })`)
    record(
      'Enter → YouTube 검색 결과가 새 탭으로 열린다 (noopener) · 링크 추가는 제출되지 않는다',
      url.origin === 'https://www.youtube.com' &&
        url.pathname === '/results' &&
        url.searchParams.get('search_query') === '아이유 밤편지' &&
        opener === true &&
        after.tracks === 1 &&
        after.error === '' &&
        after.formOpen,
      { url: opened.url, opener, after, focusedOnOpen: focused },
    )
    await h.cdp.send('Target.closeTarget', { targetId: opened.targetId })

    /* 2. 단추로도 연다 */
    const before2 = (await pages()).map((t) => t.targetId)
    await click('form.yt-search .search-go')
    const opened2 = await waitFor(
      async () =>
        (await pages()).find((t) => !before2.includes(t.targetId) && t.url.includes('youtube.com')),
      { label: 'search tab 2', timeout: 15_000 },
    )
    record(
      '"YouTube에서 검색" 단추도 같은 주소를 연다',
      new URL(opened2.url).searchParams.get('search_query') === '아이유 밤편지',
      {
        url: opened2.url,
      },
    )
    await h.cdp.send('Target.closeTarget', { targetId: opened2.targetId })

    /* 3. 링크 칸에 곡 이름을 적으면 검색어로 옮긴다 */
    await ev(
      `(() => { const s = document.querySelector('#yt-search-query'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
    )
    await typeInto('#track-url', '밤편지')
    await click('form.link-form button[type="submit"]')
    await sleep(300)
    const moved = await ev(`({
      error: document.querySelector('#track-url-error')?.textContent.trim(),
      query: document.querySelector('#yt-search-query')?.value,
      tracks: JSON.parse(localStorage.getItem('39page.library')).data.playlists[0].tracks.length,
    })`)
    record(
      '링크 칸의 곡 이름 → 오류 대신 검색어로 옮긴다',
      moved.query === '밤편지' && moved.error.includes('YouTube에서 검색') && moved.tracks === 1,
      moved,
    )

    /* 4. 배치 — 1440 · 390 · 320 에서 넘침 없음 · 44px */
    const layout = []
    for (const [w, hgt] of [
      [1440, 900],
      [390, 844],
      [320, 640],
    ]) {
      await size(w, hgt)
      await sleep(600)
      const m = await ev(`(() => {
        const form = document.querySelector('form.yt-search')
        form.scrollIntoView({ block: 'center' })
        const f = form.getBoundingClientRect()
        const input = document.querySelector('#yt-search-query').getBoundingClientRect()
        const button = document.querySelector('form.yt-search .search-go').getBoundingClientRect()
        return {
          inside: [input, button].every((r) => r.left >= f.left - 0.5 && r.right <= f.right + 0.5),
          buttonHeight: Math.round(button.height),
          inputWidth: Math.round(input.width),
          pageOverflow: document.scrollingElement.scrollWidth > innerWidth,
          box: { x: f.x + scrollX, y: f.y + scrollY - 260, width: f.width, height: f.height + 270 },
        }
      })()`)
      layout.push({ width: w, ...m, box: undefined })
      await sleep(250)
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...m.box, y: Math.max(0, m.box.y), scale: 1 },
      })
      writeFileSync(path.join(OUT, `search-${w}.png`), Buffer.from(shot.data, 'base64'))
    }
    record(
      '검색 칸 배치 — 1440 · 390 · 320 에서 양식 안 · 단추 44px · 가로 넘침 없음',
      layout.every(
        (x) => x.inside && x.buttonHeight >= 44 && !x.pageOverflow && x.inputWidth >= 150,
      ),
      { layout },
    )

    /* 5. 검색어를 저장하지 않는다 */
    const keys = await ev(`Object.keys(localStorage).filter((k) => k.startsWith('39page')).sort()`)
    record(
      '검색어를 저장하지 않는다',
      !keys.some((k) => /search/i.test(k)) &&
        !(await ev(`JSON.stringify(localStorage).includes('밤편지')`)),
      {
        keys,
      },
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
  path.join(OUT, 'real-chrome-search.json'),
  `${JSON.stringify({ when: new Date().toISOString(), passed, total: results.length, results }, null, 2)}\n`,
)
console.log(`${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
