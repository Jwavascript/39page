// M11-7A 시안의 주요 인터랙션을 실제 Chrome 입력(CDP 마우스 · 키)으로 확인한다.
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const INT = 'file:///' + process.env.REPO_INT.split(String.fromCharCode(92)).join('/')
const { launch, BASE, sleep, waitFor } = await import(INT + '/harness.mjs')
const h = await launch({ chrome: process.env.POC_CHROME, webDist: process.env.WEB_DIST, headful: false })
const results = []
const step = async (name, fn) => {
  try {
    const detail = await fn()
    results.push({ name, pass: detail.pass !== false, detail })
  } catch (error) {
    results.push({ name, pass: false, error: String(error.message ?? error) })
  }
  console.log(results.at(-1).pass ? 'PASS' : 'FAIL', name, JSON.stringify(results.at(-1).detail ?? results.at(-1).error))
}
try {
  const page = await h.tab('about:blank')
  const send = (m, p) => h.cdp.send(m, p, page.session)
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  const open = async (hash) => {
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(150)
    await send('Page.navigate', { url: `${BASE}/index.html#/${hash}` })
    await waitFor(() => page.ev(`!!document.querySelector('.proto-stage')`), { label: hash })
    await sleep(500)
  }
  const center = (sel) =>
    page.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const click = async (sel) => {
    const p = await center(sel)
    if (!p) throw new Error(`없음: ${sel}`)
    await sleep(60)
    const q = await center(sel)
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', clickCount: 1 })
    await sleep(150)
  }
  const key = async (k, code, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { ' ': 32, Enter: 13, ArrowUp: 38, ArrowDown: 40, Escape: 27 }[k] ?? 0, text })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code })
    await sleep(120)
  }
  const type = async (text) => {
    await send('Input.insertText', { text })
    await sleep(100)
  }
  const ev = (e) => page.ev(e)

  await step('대시보드 — 지금 재생목록 줄을 누르면 그 곡이 재생된다', async () => {
    await open('dashboard?w=1321&h=761&fit=0&arch=off')
    await click('.w-queue .q-row[data-i="3"]')
    const now = await ev(`document.querySelector('.w-player .now-title').textContent.trim()`)
    const cur = await ev(`document.querySelector('.w-queue .q-row.is-current .t').textContent.trim()`)
    return { pass: now === cur && now === 'Synth Rain', now }
  })

  await step('큐 스냅샷 — 보관함에서 순서가 바뀌면 안내, "새 순서로 이어 재생" 뒤 사라진다', async () => {
    await click('[data-act="scenarioReorder"]')
    const notice = await ev(`!!document.querySelector('.w-queue .notice')`)
    const nowBefore = await ev(`document.querySelector('.w-player .now-title').textContent.trim()`)
    await click('.w-queue [data-act="resync"]')
    const after = await ev(`!!document.querySelector('.w-queue .notice')`)
    const nowAfter = await ev(`document.querySelector('.w-player .now-title').textContent.trim()`)
    return { pass: notice && !after && nowBefore === nowAfter, notice, after, nowBefore, nowAfter }
  })

  await step('목록 바꾸기 ▾ — 다른 목록을 고르면 그 목록이 처음부터 재생된다', async () => {
    await click('.w-queue [data-act="popover"]')
    await click('.popover [data-act="playList"][data-id="p4"]')
    const name = await ev(`document.querySelector('.w-queue .q-name').textContent.trim()`)
    const pop = await ev(`!!document.querySelector('.popover')`)
    return { pass: name === 'City Pop' && !pop, name }
  })

  await step('보관함에서 다른 목록을 골라도 대시보드 재생 큐는 그대로 (고른 목록 ≠ 재생 큐)', async () => {
    await click('.w-deck .deck-open--mono')
    await click('.pl-row[data-id="p7"]')
    const selected = await ev(`document.querySelector('.pl-item.is-selected .n').textContent.trim()`)
    const playingMark = await ev(`[...document.querySelectorAll('.pl-item')].filter((li) => li.querySelector('.playing')).map((li) => li.querySelector('.n').textContent.trim())`)
    const sub = await ev(`document.querySelector('.w-player .now-sub').textContent.trim()`)
    return { pass: selected === '재즈 피아노' && playingMark.join() === 'City Pop' && sub.startsWith('City Pop'), selected, playingMark, sub }
  })

  await step('보관함 B 배치 — 열린 채로 Moment 를 잡고(B) 메모 입력 후 Enter 로 저장', async () => {
    const before = await ev(`document.querySelectorAll('.w-moments .m-row').length`)
    await click('.w-moments [data-act="capture"]')
    const draft = await ev(`!!document.querySelector('.w-moments .m-card.is-draft')`)
    await click('.w-moments textarea')
    await type('브릿지 시작')
    await key('Enter', 'Enter', '\r')
    const after = await ev(`document.querySelectorAll('.w-moments .m-row').length`)
    const fresh = await ev(`document.querySelector('.w-moments .m-row.is-new .note')?.textContent ?? ''`)
    return { pass: draft && after === before + 1 && fresh.includes('브릿지 시작'), before, after, fresh }
  })

  await step('B 취소 — 잡은 뒤 취소하면 아무것도 생기지 않는다', async () => {
    const before = await ev(`document.querySelectorAll('.w-moments .m-row').length`)
    await click('.w-moments [data-act="capture"]')
    await click('.w-moments [data-act="mCancel"]')
    const after = await ev(`document.querySelectorAll('.w-moments .m-row').length`)
    return { pass: before === after, before, after }
  })

  await step('A/B 화면 — A 는 누르는 순간 쓰기 1, B 는 저장을 눌러야 쓰기 1', async () => {
    await open('moments')
    await click('[data-act="capture"][data-ctx="abA"]')
    const a = await ev(`document.querySelectorAll('.compare > section')[0].querySelector('.metric').textContent`)
    await click('[data-act="capture"][data-ctx="abB"]')
    const b1 = await ev(`document.querySelectorAll('.compare > section')[1].querySelector('.metric').textContent`)
    await click('[data-act="mSave"][data-ctx="abB"]')
    const b2 = await ev(`document.querySelectorAll('.compare > section')[1].querySelector('.metric').textContent`)
    return { pass: /쓰기 1/.test(a.replace(/\s+/g, ' ')) && /쓰기 0/.test(b1.replace(/\s+/g, ' ')) && /쓰기 1/.test(b2.replace(/\s+/g, ' ')), a, b1, b2 }
  })

  await step('A/B — B 저장 실패 흉내: 카드와 메모가 남고 쓰기 0', async () => {
    await click('[data-act="failNext"][data-ctx="abB"]')
    await click('[data-act="capture"][data-ctx="abB"]')
    await click('textarea[data-ctx="abB"]')
    await type('남아야 함')
    await click('[data-act="mSave"][data-ctx="abB"]')
    const chip = await ev(`document.querySelectorAll('.compare > section')[1].querySelector('.state-chip').textContent`)
    const note = await ev(`document.querySelector('textarea[data-ctx="abB"]').value`)
    return { pass: chip.includes('저장 못 함') && note === '남아야 함', chip, note }
  })

  await step('트랙 정렬 — 키보드: ≡ Space → ↑↑ → Space 로 3번째를 1번째로', async () => {
    await open('reorder')
    const title = await ev(`document.querySelector('[data-list="ro:A"] .t-item:nth-child(3) .t').textContent.replace(/^\\s*\\d+\\s*/, '').trim()`)
    await ev(`document.querySelector('[data-list="ro:A"] .t-item:nth-child(3) .handle').focus(); true`)
    await key(' ', 'Space', ' ')
    await key('ArrowUp', 'ArrowUp')
    await key('ArrowUp', 'ArrowUp')
    await key(' ', 'Space', ' ')
    const first = await ev(`document.querySelector('[data-list="ro:A"] .t-item:nth-child(1) .t').textContent.replace(/^\\s*\\d+\\s*/, '').trim()`)
    const live = await ev(`document.getElementById('live').textContent`)
    const focused = await ev(`document.activeElement?.classList.contains('handle')`)
    return { pass: first === title && focused, title, first, live }
  })

  await step('트랙 정렬 — 마우스 끌기: C 의 1번째 ≡ 를 5번째 줄 아래로', async () => {
    const title = await ev(`document.querySelector('[data-list="ro:C"] .t-item:nth-child(1) .t').textContent.replace(/^\\s*\\d+\\s*/, '').trim()`)
    const from = await center('[data-list="ro:C"] .t-item:nth-child(1) .handle')
    const to = await ev(`(() => { const r = document.querySelector('[data-list="ro:C"] .t-item:nth-child(5)').getBoundingClientRect(); return { y: r.y + r.height * 0.8 } })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 12; i += 1)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + ((to.y - from.y) * i) / 12, button: 'left', buttons: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: to.y, button: 'left', clickCount: 1 })
    await sleep(200)
    const order = await ev(`[...document.querySelectorAll('[data-list="ro:C"] .t-item .t')].map((t) => t.textContent.replace(/^\\s*\\d+\\s*/, '').trim())`)
    const idx = order.indexOf(title)
    return { pass: idx >= 3 && idx <= 5, title, idx }
  })

  await step('트랙 정렬 — ⋯ → 맨 아래로', async () => {
    const title = await ev(`document.querySelector('[data-list="ro:A"] .t-item:nth-child(2) .t').textContent.replace(/^\\s*\\d+\\s*/, '').trim()`)
    await click('[data-list="ro:A"] .t-item:nth-child(2) [data-act="tMenu"]')
    await click('[data-list="ro:A"] .more-menu [data-v="bottom"]')
    const last = await ev(`[...document.querySelectorAll('[data-list="ro:A"] .t-item .t')].at(-1).textContent.replace(/^\\s*\\d+\\s*/, '').trim()`)
    return { pass: last === title, title, last }
  })

  await step('트랙 정렬 — B 편집 모드: ▶ 숨김 · ✕ → 확인 → 삭제', async () => {
    await click('[data-act="roEdit"][data-v="B"]')
    const plays = await ev(`document.querySelectorAll('[data-list="ro:B"] .t-play').length`)
    const before = await ev(`document.querySelectorAll('[data-list="ro:B"] .t-item').length`)
    await click('[data-list="ro:B"] .t-item:nth-child(1) [data-act="tDelete"]')
    await click('[data-list="ro:B"] [data-act="tDeleteOk"]')
    const after = await ev(`document.querySelectorAll('[data-list="ro:B"] .t-item').length`)
    return { pass: plays === 0 && after === before - 1, plays, before, after }
  })

  await step('보관함 — 링크 추가: 넣으면 곡이 늘고 칸이 남아 다음 링크를 받는다', async () => {
    await open('archive?step=detail&size=uat')
    const count = await ev(`document.querySelector('.device .detail .t-list').children.length`)
    await click('.device [data-act="addOpen"]')
    await click('.device #add-url')
    await type('https://www.youtube.com/watch?v=abcdefghijk')
    await key('Enter', 'Enter', '\r')
    const after = await ev(`document.querySelector('.device .detail .t-list').children.length`)
    const stillOpen = await ev(`!!document.querySelector('.device #add-url')`)
    const focus = await ev(`document.activeElement?.id`)
    return { pass: after === count + 1 && stillOpen && focus === 'add-url', count, after, focus }
  })

  await step('보관함 — 목록 ⋯ → 이름 바꾸기 · 삭제 확인', async () => {
    await click('.device .pl-item:nth-child(3) [data-act="plMenu"]')
    await click('.device .more-menu [data-act="plDelete"]')
    const confirm = await ev(`!!document.querySelector('.device .confirm')`)
    await click('.device .confirm [data-act="plDelete"]')
    const gone = await ev(`!document.querySelector('.device .confirm')`)
    return { pass: confirm && gone, confirm, gone }
  })

  await step('모바일 보관함 — 목록 → 상세 → ‹ 목록', async () => {
    await open('mobile?arch=music&step=list&order=M1')
    const frame = '.frames .frame-wrap:nth-child(2)'
    const listVisible = await ev(`getComputedStyle(document.querySelector('${frame} .pl-col')).display !== 'none'`)
    await click(`${frame} .pl-row[data-id="p2"]`)
    const detail = await ev(`getComputedStyle(document.querySelector('${frame} .detail')).display !== 'none' && getComputedStyle(document.querySelector('${frame} .pl-col')).display === 'none'`)
    const crumb = await ev(`document.querySelector('${frame} .crumb').textContent`)
    await click(`${frame} [data-act="mStep"][data-v="list"]`)
    const back = await ev(`getComputedStyle(document.querySelector('${frame} .pl-col')).display !== 'none'`)
    return { pass: listVisible && detail && back, crumb }
  })

  await step('모바일 — 영상이 데크보다 먼저 (M1) · 위젯 안쪽 스크롤 없음', async () => {
    await open('mobile?arch=off&order=M1')
    const frame = '.frames .frame-wrap:nth-child(2)'
    const order = await ev(`(() => { const y = (s) => document.querySelector('${frame} ' + s).getBoundingClientRect().top; return { player: y('.w-player'), moments: y('.w-moments'), queue: y('.w-queue'), deck: y('.w-deck') } })()`)
    const inner = await ev(`document.querySelectorAll('${frame} .w-queue .scroll-area, ${frame} .w-moments .scroll-area').length`)
    return { pass: order.player < order.moments && order.moments < order.queue && order.queue < order.deck && inner === 0, order, inner }
  })

  await step('테마 바꾸기 — 같은 화면 · 재생 상태 유지', async () => {
    await open('dashboard?w=1321&h=761&fit=0&arch=off&theme=mono-vinyl')
    const t0 = await ev(`document.querySelector('.w-player .now-title').textContent`)
    await click('#themeToggle')
    const theme = await ev(`document.documentElement.dataset.theme`)
    const t1 = await ev(`document.querySelector('.w-player .now-title').textContent`)
    const deck = await ev(`[...document.querySelectorAll('.w-deck svg')].map((s) => getComputedStyle(s).display)`)
    return { pass: theme === 'kawaii-synth-cassette' && t0 === t1 && deck.join() === 'none,block', theme, deck }
  })

  await step('빈 상태 — 목록이 없으면 안내와 "새 목록 만들고 링크 추가"', async () => {
    await open('dashboard?w=1321&h=761&fit=0&arch=off&size=empty')
    const txt = await ev(`document.querySelector('.w-queue').textContent.replace(/\\s+/g, ' ')`)
    const cap = await ev(`document.querySelector('.w-moments [data-act="capture"]').disabled`)
    return { pass: txt.includes('새 목록 만들고 링크 추가') && cap, cap }
  })

  writeFileSync(path.join(process.env.OUT, 'interact.json'), JSON.stringify(results, null, 2))
  console.log(`${results.filter((r) => r.pass).length}/${results.length} PASS`)
} finally {
  h.cdp.close()
  h.kill()
}
