/*
 * M11-7A 비교 시안 — 샘플 데이터만 쓰는 데모 동작이다. 실제 구현이 아니다.
 *
 * - 39page store · localStorage · YouTube · 외부 API 에 연결하지 않는다. 저장하지 않는다 (새로고침하면 처음으로).
 * - "재생" 은 숫자가 1초씩 늘어나는 흉내다. 소리 · 영상이 없다.
 * - 화면 상태는 주소의 # 뒤에 적어 같은 화면을 다시 열 수 있게 한다 (스크린샷 · 공유용).
 */
'use strict'
;(() => {
  /* ───────────────────────── 도우미 ───────────────────────── */

  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  const fmt = (seconds) => {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const pad2 = (n) => String(n).padStart(2, '0')
  let seq = 1000
  const uid = (prefix) => `${prefix}${(seq += 1)}`

  /* ───────────────────────── 샘플 데이터 (가상의 곡) ───────────────────────── */

  const SONGS = [
    'Midnight Highway — Neon Drive',
    'Rainy Window Lo-fi Session (아주 긴 제목이 두 줄로 넘어가는지 확인하기 위한 라이브 버전 · Remastered 2026)',
    'Seoul City Pop 1986',
    'Morning Coffee Jazz Trio',
    'Synth Rain',
    '창가의 오후',
    'Pixel Hearts (8-bit Cover)',
    'Blue Hour Piano',
    'Sunset Boulevard Funk',
    '잠들기 전 듣는 노래',
    'Last Train Home',
    'Cassette Memories',
    'Analog Dreams',
    'Tokyo Night Walk',
    'Ocean Static',
  ]
  const VID = (n) => `v${String(n).padStart(3, '0')}xxxxxxx`.slice(0, 11)
  const UAT_LISTS = [
    'MY RECORDS',
    '새벽 드라이브',
    '작업할 때',
    '비 오는 날 — 창가에서 듣는 아주 긴 이름의 플레이리스트',
    'City Pop',
    '운동',
    'Lo-fi',
    '재즈 피아노',
    '2000s',
    '여행',
    '잠들기 전',
  ]
  const UAT_COUNTS = [6, 4, 1, 2, 1, 2, 1, 2, 1, 1, 1]

  function track(n) {
    const song = n % SONGS.length
    return { id: uid('t'), videoId: VID(song), title: SONGS[song] }
  }

  function makeLibrary(size) {
    if (size === 'empty') return []
    if (size === 'few') {
      return [
        { id: 'p0', name: 'MY RECORDS', tracks: [track(0)] },
        { id: 'p1', name: '새벽 드라이브', tracks: Array.from({ length: 10 }, (_, k) => track(k + 1)) },
        { id: 'p2', name: '작업할 때', tracks: Array.from({ length: 30 }, (_, k) => track(k + 3)) },
      ]
    }
    if (size === 'many') {
      return Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        name: i < UAT_LISTS.length ? UAT_LISTS[i] : `믹스 ${pad2(i)} — ${SONGS[i % SONGS.length].split(' ')[0]}`,
        tracks: Array.from({ length: i === 1 ? 100 : 3 + ((i * 7) % 28) }, (_, k) => track(i + k)),
      }))
    }
    return UAT_LISTS.map((name, i) => ({
      id: `p${i}`,
      name,
      tracks: Array.from({ length: UAT_COUNTS[i] }, (_, k) => track(i + k)),
    }))
  }

  function makeMoments(playlists) {
    if (playlists.length === 0) return []
    const now = playlists[1] ?? playlists[0]
    const current = now.tracks[1] ?? now.tracks[0]
    const notes = [
      [12, '인트로 신스'],
      [43, '후렴 직전 — 베이스가 들어오는 곳'],
      [71, ''],
      [98, '브릿지. 메모가 길면 두 줄까지 보이고 나머지는 보관함에서 펼쳐 봅니다 — 대시보드는 미리보기'],
      [131, '드럼 필'],
      [162, '마지막 후렴'],
      [201, '아웃트로'],
    ]
    const list = notes.map(([at, note]) => ({
      id: uid('m'),
      videoId: current.videoId,
      atSeconds: at,
      note,
      title: current.title,
    }))
    for (const [i, at] of [
      [0, 30],
      [2, 75],
      [3, 15],
      [4, 140],
      [7, 52],
    ]) {
      list.push({ id: uid('m'), videoId: VID(i), atSeconds: at, note: i === 3 ? '첫 마디' : '', title: SONGS[i] })
    }
    return list
  }

  const durationOf = (t) => 150 + ((t.videoId.charCodeAt(2) * 37 + t.videoId.charCodeAt(3) * 11) % 140)

  /* ───────────────────────── 상태 ───────────────────────── */

  const S = {
    theme: 'mono-vinyl',
    screen: 'dashboard',
    // 대시보드
    variant: 'proposed', // proposed | current
    size: 'uat',
    w: 1321,
    h: 761,
    fit: true,
    header: 'H1',
    archOpen: false,
    archTab: 'music',
    layout: 'B',
    order: 'M1',
    momentModel: 'B',
    reorder: 'C',
    showHit: false,
    dataOpen: false,
    // 라이브러리 (가짜)
    playlists: [],
    selectedId: null,
    // 재생 (가짜) — 큐는 스냅샷, 출처는 메모리에만
    queue: [],
    queueIndex: -1,
    queueSource: null,
    playing: false,
    started: false,
    time: 0,
    status: '',
    // Moments
    moments: [],
    // 순간 UI
    popover: false,
    moreMenu: false,
    plMenu: null,
    plRename: null,
    plConfirm: null,
    plCreate: false,
    trMenu: null,
    trRename: null,
    trConfirm: null,
    addOpen: false,
    editMode: false,
    mStep: 'list',
    plQuery: '',
    momChip: 'all',
    grab: null,
    dragging: false,
    // 트랙 정렬 비교
    ro: null,
    roDevice: 'desktop',
    // Moment A/B
    ab: null,
  }

  const dash = {
    key: 'dash',
    draft: null,
    noteFor: null,
    justSaved: null,
    fail: false,
    failNext: false,
    log: [],
    writes: 0,
    clicks: 0,
  }

  function resetData() {
    S.playlists = makeLibrary(S.size)
    S.moments = makeMoments(S.playlists)
    S.selectedId = S.playlists[0]?.id ?? null
    S.queue = []
    S.queueIndex = -1
    S.queueSource = null
    S.playing = false
    S.started = false
    S.time = 0
    S.status = ''
    Object.assign(dash, { draft: null, noteFor: null, justSaved: null, fail: false, log: [], writes: 0, clicks: 0 })
    // UAT 사례: 보관함에서 고른 목록(MY RECORDS) 과 재생 중인 목록(새벽 드라이브) 이 다르다.
    const playingList = S.playlists[1] ?? S.playlists[0]
    if (playingList !== undefined && playingList.tracks.length > 0) {
      startQueue(playingList, Math.min(1, playingList.tracks.length - 1))
      S.time = 52
      S.playing = S.size !== 'few'
    }
  }

  function resetReorder() {
    const base = Array.from({ length: 10 }, (_, k) => track(k))
    S.ro = {
      A: base.map((t) => ({ ...t })),
      B: base.map((t) => ({ ...t })),
      C: base.map((t) => ({ ...t })),
      edit: { A: false, B: false, C: false },
      clicks: { A: 0, B: 0, C: 0 },
    }
  }

  function resetAB() {
    const song = { videoId: VID(0), title: SONGS[0] }
    const mk = (model) => ({
      key: `ab${model}`,
      model,
      song,
      time: 40,
      playing: true,
      moments: [
        { id: uid('m'), videoId: song.videoId, atSeconds: 12, note: '인트로 신스', title: song.title },
      ],
      draft: null,
      noteFor: null,
      justSaved: null,
      fail: false,
      failNext: false,
      log: [],
      writes: 0,
      clicks: 0,
    })
    S.ab = { A: mk('A'), B: mk('B') }
  }

  /* ───────────────────────── 가짜 재생 ───────────────────────── */

  const currentTrack = () => (S.queueIndex >= 0 ? (S.queue[S.queueIndex] ?? null) : null)
  const playlistById = (id) => S.playlists.find((p) => p.id === id)

  function startQueue(playlist, index) {
    S.queue = playlist.tracks.map((t) => ({ ...t })) // 스냅샷
    S.queueIndex = index
    S.queueSource = { playlistId: playlist.id, name: playlist.name }
    S.playing = true
    S.started = true
    S.time = 0
    S.status = ''
  }

  function jumpQueue(index) {
    if (index < 0 || index >= S.queue.length) return false
    S.queueIndex = index
    S.time = 0
    S.playing = true
    S.started = true
    return true
  }

  /** 큐 출처 목록의 지금 순서가 큐(스냅샷)와 다른가 — 순서 바꾸기 · 추가 · 삭제 뒤. */
  function queueDiverged() {
    if (S.queueSource === null) return false
    const list = playlistById(S.queueSource.playlistId)
    if (list === undefined) return 'deleted'
    const a = list.tracks.map((t) => t.id).join(',')
    const b = S.queue.map((t) => t.id).join(',')
    return a === b ? false : 'changed'
  }

  function resyncQueue() {
    const list = playlistById(S.queueSource?.playlistId)
    const cur = currentTrack()
    if (list === undefined || cur === null) return
    const at = S.time
    const idx = list.tracks.findIndex((t) => t.id === cur.id)
    S.queue = list.tracks.map((t) => ({ ...t }))
    S.queueIndex = idx === -1 ? 0 : idx
    S.queueSource = { playlistId: list.id, name: list.name }
    if (idx !== -1) S.time = at
    say('새 순서로 이어서 재생해요 — 지금 곡은 그대로입니다.')
  }

  function playMomentDash(m) {
    const cur = currentTrack()
    if (cur !== null && cur.videoId === m.videoId) {
      S.time = m.atSeconds
      S.playing = true
      return
    }
    const inQueue = S.queue.findIndex((t) => t.videoId === m.videoId)
    if (inQueue !== -1) {
      jumpQueue(inQueue)
    } else {
      const ordered = [playlistById(S.selectedId), ...S.playlists].filter(Boolean)
      const hit = ordered.find((p) => p.tracks.some((t) => t.videoId === m.videoId))
      if (hit !== undefined) startQueue(hit, hit.tracks.findIndex((t) => t.videoId === m.videoId))
      else {
        S.queue = [{ id: uid('t'), videoId: m.videoId, title: m.title }]
        S.queueIndex = 0
        S.queueSource = null
        S.playing = true
        S.started = true
      }
    }
    S.time = m.atSeconds
  }

  setInterval(() => {
    let changed = false
    if (S.playing && currentTrack() !== null) {
      S.time += 1
      if (S.time >= durationOf(currentTrack())) {
        if (!jumpQueue(S.queueIndex + 1)) {
          S.playing = false
          S.status = '목록의 마지막 곡이 끝났어요.'
        }
        changed = true
      }
    }
    if (S.ab !== null) {
      for (const ctx of [S.ab.A, S.ab.B]) if (ctx.playing) ctx.time = (ctx.time + 1) % 240
    }
    if (changed) softRender()
    else updateLive()
  }, 1000)

  /** 1초마다 숫자만 바꾼다 — 다시 그리지 않아 입력 중인 칸의 포커스를 지킨다. */
  function updateLive() {
    const cur = currentTrack()
    for (const el of document.querySelectorAll('[data-live="time"]')) {
      const ctx = el.dataset.ctx
      if (ctx === 'abA' || ctx === 'abB') el.textContent = fmt(S.ab[ctx.slice(2)].time)
      else el.textContent = cur === null ? '–:––' : fmt(S.time)
    }
    for (const el of document.querySelectorAll('[data-live="bar"]')) {
      el.style.width = cur === null ? '0' : `${Math.min(100, (S.time / durationOf(cur)) * 100)}%`
    }
    for (const el of document.querySelectorAll('[data-live="clock"]')) el.innerHTML = dotClockInner()
  }

  /* ───────────────────────── 주소 ↔ 상태 ───────────────────────── */

  const HASH_KEYS = ['w', 'h', 'variant', 'size', 'header', 'arch', 'tab', 'layout', 'order', 'mm', 'ro', 'fit', 'step', 'hit', 'theme']

  function readHash() {
    const [screen, query] = location.hash.replace(/^#\/?/, '').split('?')
    if (screen) S.screen = screen
    const q = new URLSearchParams(query ?? '')
    if (q.has('w')) S.w = Number(q.get('w'))
    if (q.has('h')) S.h = Number(q.get('h'))
    if (q.has('variant')) S.variant = q.get('variant')
    if (q.has('size')) S.size = q.get('size')
    if (q.has('header')) S.header = q.get('header')
    if (q.has('arch')) {
      S.archOpen = q.get('arch') !== 'off'
      if (S.archOpen) S.archTab = q.get('arch')
    }
    if (q.has('layout')) S.layout = q.get('layout')
    if (q.has('order')) S.order = q.get('order')
    if (q.has('mm')) S.momentModel = q.get('mm')
    if (q.has('ro')) S.reorder = q.get('ro')
    if (q.has('fit')) S.fit = q.get('fit') !== '0'
    if (q.has('step')) S.mStep = q.get('step')
    if (q.has('hit')) S.showHit = q.get('hit') === '1'
    if (q.has('theme')) S.theme = q.get('theme')
  }

  function writeHash() {
    const q = new URLSearchParams({
      w: S.w,
      h: S.h,
      variant: S.variant,
      size: S.size,
      header: S.header,
      arch: S.archOpen ? S.archTab : 'off',
      layout: S.layout,
      order: S.order,
      mm: S.momentModel,
      ro: S.reorder,
      fit: S.fit ? '1' : '0',
      step: S.mStep,
      hit: S.showHit ? '1' : '0',
      theme: S.theme,
    })
    void HASH_KEYS
    history.replaceState(null, '', `#/${S.screen}?${q.toString()}`)
  }

  /* ───────────────────────── 작은 그림 ───────────────────────── */

  const GLYPHS = {
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
    ':': ['0', '0', '1', '0', '1', '0', '0'],
  }

  function dotClockInner() {
    const d = new Date()
    const h = d.getHours() % 12 || 12
    const text = `${pad2(h)}:${pad2(d.getMinutes())}`
    let x = 5
    let out = ''
    for (const ch of text) {
      const g = GLYPHS[ch]
      const cols = ch === ':' ? 1 : 5
      for (let r = 0; r < 7; r += 1)
        for (let c = 0; c < cols; c += 1)
          out += `<circle class="${g[r][c] === '1' ? 'on' : 'off'}" cx="${(x + c * 9.3).toFixed(1)}" cy="${(6 + r * 9.3).toFixed(1)}" r="3.1"/>`
      x += cols * 9.3 + 13
    }
    return out
  }

  const MASCOT = [
    '0000000000000000',
    '0011000000001100',
    '0011100000011100',
    '0010111111101100',
    '0011111111111100',
    '0011111111111100',
    '0011001111001100',
    '0011101111011100',
    '0011111111111100',
    '0001111001111000',
    '0000011111100000',
    '0000000000000000',
  ]
  const mascotSvg = () => {
    let dots = ''
    MASCOT.forEach((row, r) => {
      ;[...row].forEach((bit, c) => {
        if (bit === '1') dots += `<circle cx="${c * 7 + 4}" cy="${r * 7 + 4}" r="2.7"/>`
      })
    })
    return `<svg viewBox="0 0 112 84" aria-hidden="true">${dots}</svg>`
  }

  let deckSeq = 0
  /** 같은 SVG 를 여러 번 넣으면 그라디언트 id 가 겹친다 — 인스턴스마다 접두어를 붙인다. */
  function deckSvg(kind) {
    deckSeq += 1
    const p = `d${deckSeq}-`
    return window.DECK_SVG[kind]
      .replace(/id="(mv|ksc)-/g, `id="${p}$1-`)
      .replace(/url\(#(mv|ksc)-/g, `url(#${p}$1-`)
      .replace(/href="#(mv|ksc)-/g, `href="#${p}$1-`)
  }

  /* ───────────────────────── 위젯 ───────────────────────── */

  const isMono = () => S.theme === 'mono-vinyl'
  const deckWord = () => (isMono() ? 'LP' : '카세트')

  function headerHTML(width) {
    const narrow = width <= 700
    const theme = `<div class="theme-switch" role="group" aria-label="테마">
        <button type="button" data-act="theme" data-v="mono-vinyl" aria-pressed="${isMono()}">01 / MONO VINYL</button>
        <button type="button" data-act="theme" data-v="kawaii-synth-cassette" aria-pressed="${!isMono()}">02 / SYNTH CASSETTE</button></div>`
    let nav
    if (S.header === 'now') {
      nav = `<button type="button" class="nav-button ${S.archOpen && S.archTab === 'music' ? 'is-active' : ''}" data-act="arch" data-v="music"><span aria-hidden="true">♪</span> 음악</button>
        <button type="button" class="nav-button ${S.archOpen && S.archTab === 'moments' ? 'is-active' : ''}" data-act="arch" data-v="moments"><span aria-hidden="true">◆</span> Moments</button>
        <button type="button" class="nav-button" data-act="data"><span aria-hidden="true">⇩</span> 데이터</button>${theme}`
    } else if (S.header === 'H2' && narrow) {
      nav = `<button type="button" class="nav-button ${S.archOpen ? 'is-active' : ''}" data-act="arch" data-v="last" aria-expanded="${S.archOpen}"><span aria-hidden="true">▤</span> 보관함</button>
        <span style="position:relative"><button type="button" class="nav-button" data-act="moreMenu" aria-haspopup="menu" aria-expanded="${S.moreMenu}"><span aria-hidden="true">⋯</span> 더보기</button>
        ${S.moreMenu ? `<div class="more-menu" role="menu"><button type="button" class="menu-item" role="menuitem" data-act="data">⇩ 데이터 · 백업</button><div class="menu-sep"></div><button type="button" class="menu-item" role="menuitem" data-act="theme" data-v="mono-vinyl">${isMono() ? '● ' : '○ '}Mono Vinyl</button><button type="button" class="menu-item" role="menuitem" data-act="theme" data-v="kawaii-synth-cassette">${isMono() ? '○ ' : '● '}Synth Cassette</button></div>` : ''}</span>`
    } else {
      nav = `<button type="button" class="nav-button ${S.archOpen ? 'is-active' : ''}" data-act="arch" data-v="last" aria-expanded="${S.archOpen}"><span aria-hidden="true">▤</span> 보관함</button>
        <button type="button" class="nav-button" data-act="data"><span aria-hidden="true">⇩</span> 데이터 · 백업</button>${theme}`
    }
    return `<header class="app-header"><span class="brand">39page</span><div class="header-actions" ${narrow ? 'style="flex:1 1 100%;justify-content:flex-start"' : ''}>${nav}</div></header>`
  }

  function deckHTML() {
    const cls = S.playing ? 'is-playing' : S.started ? 'is-paused' : ''
    return `<section class="w-deck ${cls}" aria-label="데크">
      <div class="deck-graphic ${S.showHit ? 'show-hit' : ''}">
        ${deckSvg('mono')}${deckSvg('kawaii')}
        <button type="button" class="deck-open deck-open--mono" data-act="arch" data-v="music" aria-label="LP를 눌러 음악 보관함 열기"><span class="hint">OPEN LIBRARY ↗</span></button>
        <button type="button" class="deck-open deck-open--kawaii" data-act="arch" data-v="music" aria-label="카세트를 눌러 음악 보관함 열기"><span class="hint">▶ OPEN MIXTAPES</span></button>
        <button type="button" class="deck-key deck-key--mono" data-act="toggle" aria-label="${S.playing ? '일시정지' : '재생'}" title="${S.playing ? '일시정지' : '재생'}"></button>
        <button type="button" class="deck-key deck-key--kawaii-stop" data-act="pause" aria-label="일시정지" title="일시정지"></button>
        <button type="button" class="deck-key deck-key--kawaii-play" data-act="play" aria-label="재생" title="재생"></button>
      </div>
      <p class="deck-hint">${isMono() ? '◉' : '✧'} <strong>${deckWord()}를 누르면</strong> ${isMono() ? '음악 보관함이 열려요' : '믹스테이프 보관함이 열려요'} · 아래 키 = 재생</p>
    </section>`
  }

  function miniDeckHTML() {
    const cur = currentTrack()
    const cls = S.playing ? 'is-playing' : S.started ? 'is-paused' : ''
    return `<section class="w-minideck ${cls}" aria-label="작은 데크">
      <div class="crop">${deckSvg('mono')}${deckSvg('kawaii')}</div>
      <div style="min-width:0;flex:1"><p class="eyebrow">${isMono() ? 'MONO VINYL' : 'SYNTH CASSETTE'}</p><p class="m-song">${cur ? esc(cur.title) : '대기 중'}</p></div>
      <button type="button" class="btn small" data-act="arch" data-v="music">보관함</button></section>`
  }

  function playerHTML(opts = {}) {
    const cur = currentTrack()
    const title = cur === null ? '재생할 음악을 선택하세요' : esc(cur.title)
    const sub =
      cur === null
        ? `${deckWord()} · ▤ 보관함에서 곡을 고르거나 링크를 추가할 수 있어요.`
        : `${S.queueSource ? esc(S.queueSource.name) : '목록 밖 영상 (Moment)'} · ${S.queueIndex + 1}/${S.queue.length}`
    const video = `<div class="video" ${opts.videoStyle ? `style="${opts.videoStyle}"` : ''}>
        <span class="fake-tag">시안 — 실제 영상 없음</span>
        <strong>YOUTUBE / VIDEO</strong>
        <span>${cur === null ? '영상은 이 위치에 16:9로 표시됩니다.' : `${S.playing ? '▶ 재생 중' : '❚❚ 일시정지'} · <span data-live="time">${fmt(S.time)}</span> / ${fmt(durationOf(cur))}`}</span>
        <div class="bar"><i data-live="bar" style="width:${cur === null ? 0 : Math.min(100, (S.time / durationOf(cur)) * 100)}%"></i></div></div>`
    const transport = `<div class="transport" role="group" aria-label="재생 조작">
        <button type="button" data-act="prev" aria-label="이전 곡" ${S.queueIndex <= 0 ? 'disabled' : ''}>⏮</button>
        <button type="button" class="main" data-act="toggle" aria-label="${S.playing ? '일시정지' : '재생'}">${S.playing ? '❚❚' : '▶'}</button>
        <button type="button" data-act="next" aria-label="다음 곡" ${S.queueIndex >= S.queue.length - 1 ? 'disabled' : ''}>⏭</button></div>`
    const status = `<p class="status ${S.status ? 'warning' : ''}" role="status">${esc(S.status)}</p>`
    if (opts.strip) {
      return `<section class="w-player" aria-label="재생"><div class="player-strip">${video}<div>
        <p class="eyebrow">NOW PLAYING · YOUTUBE</p><h2 class="now-title">${title}</h2><p class="now-sub">${sub}</p>${transport}${captureMiniHTML()}${status}</div></div></section>`
    }
    return `<section class="w-player" aria-label="재생">
      <p class="eyebrow">NOW PLAYING · YOUTUBE</p>
      <h2 class="now-title">${title}</h2><p class="now-sub">${sub}</p>
      ${video}${transport}${status}
      <p class="mute-note">YouTube 공식 영상·컨트롤은 그대로 표시됩니다.</p></section>`
  }

  function captureMiniHTML() {
    const cur = currentTrack()
    return `<button type="button" class="capture" style="margin-top:6px" data-act="capture" data-ctx="dash" ${cur === null || !S.started ? 'disabled' : ''}>
      <span>＋ 이 순간 저장</span><span class="at" data-live="time" data-ctx="dash">${cur ? fmt(S.time) : '–:––'}</span></button>`
  }

  function clockHTML() {
    const d = new Date()
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    return `<section class="w-clock" aria-label="시계">
      <div class="clock-head"><p class="eyebrow">SEOUL, KOREA</p><p class="eyebrow">${d.getHours() < 12 ? 'AM' : 'PM'}</p></div>
      <svg class="dot-clock" viewBox="0 0 252 68" aria-hidden="true" data-live="clock">${dotClockInner()}</svg>
      <p class="clock-date">${days[d.getDay()]} ${months[d.getMonth()]} ${pad2(d.getDate())} ${d.getFullYear()}</p></section>`
  }

  function weatherHTML() {
    return `<section class="w-weather" aria-label="날씨"><div class="weather"><span class="temp">18°</span><span class="desc">조금 흐림<span class="note">WEATHER / SEOUL · 시안 고정값 (API 연결 없음)</span></span></div></section>`
  }

  function mascotHTML() {
    return `<section class="w-mascot" aria-label="마스코트 자리"><div class="mascot-screen">${mascotSvg()}</div>
      <div><p class="mascot-label">COMPANION / 01</p><p class="mascot-message">${isMono() ? 'SIGNAL READY' : 'MIXTAPE READY'}</p><p class="mascot-sub">M12 마스코트 자리 (이번 범위 아님)</p></div></section>`
  }

  /* ── 지금 재생목록 (Now Playlist) ── */

  function queueWidgetHTML(width) {
    const mobile = width <= 700
    const cur = currentTrack()
    const pop = S.popover ? popoverHTML() : ''
    const switcher = S.playlists.length > 0
      ? `<div class="q-switch-wrap"><button type="button" class="btn small" data-act="popover" aria-haspopup="dialog" aria-expanded="${S.popover}">목록 바꾸기 ▾</button>${pop}</div>`
      : ''
    let head
    let rows = []
    let footer
    let notice = ''
    if (S.playlists.length === 0 && S.queue.length === 0) {
      return `<section class="w-queue" aria-label="지금 재생목록">
        <div class="q-head"><div><p class="widget-title">NOW PLAYLIST</p><p class="widget-sub">재생할 목록이 아직 없어요</p></div></div>
        <p class="empty">YouTube 링크를 담을 목록을 먼저 만들어요.<br />보관함 › 음악에서 목록을 만들면 링크 입력으로 바로 이어집니다.</p>
        <button type="button" class="btn primary" data-act="createFromEmpty">＋ 새 목록 만들고 링크 추가</button></section>`
    }
    if (S.queue.length > 0) {
      const div = queueDiverged()
      head = `<p class="widget-title">NOW PLAYLIST <span class="q-meta">· ${S.playing ? '재생 중' : '일시정지'}</span></p>
        <p class="q-name">${S.queueSource ? esc(S.queueSource.name) : '목록 밖 영상'}</p>
        <p class="q-meta">${S.queueIndex + 1} / ${S.queue.length}곡${S.queueSource && S.queueSource.playlistId !== S.selectedId && playlistById(S.selectedId) ? ` · 보관함에서 보는 목록: ${esc(playlistById(S.selectedId).name)}` : ''}</p>`
      if (div === 'changed')
        notice = `<p class="notice">보관함에서 이 목록이 바뀌었어요. 지금은 재생을 시작할 때의 순서로 이어집니다.<br /><button type="button" class="linkish" data-act="resync">새 순서로 이어 재생</button></p>`
      if (div === 'deleted')
        notice = `<p class="notice">이 목록은 보관함에서 지워졌어요. 지금 큐는 끝까지 재생할 수 있어요.</p>`
      rows = S.queue.map((t, i) => ({ t, i, current: i === S.queueIndex, played: i < S.queueIndex }))
      footer = S.queueSource
        ? `<button type="button" class="linkish" data-act="editSource">보관함에서 이 목록 편집 ↗</button>`
        : `<button type="button" class="linkish" data-act="arch" data-v="music">보관함 열기 ↗</button>`
    } else {
      const sel = playlistById(S.selectedId) ?? S.playlists[0]
      head = `<p class="widget-title">NOW PLAYLIST <span class="q-meta">· 재생 대기</span></p>
        <p class="q-name">${esc(sel.name)}</p><p class="q-meta">${sel.tracks.length}곡 · 누르면 그 곡부터 재생</p>`
      rows = sel.tracks.map((t, i) => ({ t, i, current: false, played: false, idle: true }))
      footer = `<button type="button" class="btn small primary" data-act="playSel" ${sel.tracks.length === 0 ? 'disabled' : ''}>▶ 처음부터 재생</button>
        <button type="button" class="linkish" data-act="editSelected">보관함에서 편집 ↗</button>`
      if (sel.tracks.length === 0)
        notice = `<p class="empty">이 목록은 비어 있어요. 보관함에서 YouTube 링크를 추가하세요.</p>`
    }
    // 모바일: 안쪽 스크롤 대신 지금 곡 주변 5곡 + 펼치기 (M11-3 U19 — 페이지 스크롤과 겹치지 않게)
    let list
    if (mobile && !S.queueExpanded && rows.length > 5) {
      const center = Math.max(0, rows.findIndex((r) => r.current))
      const from = Math.max(0, Math.min(center - 1, rows.length - 5))
      const shown = rows.slice(from, from + 5)
      list = `<ol class="q-list" style="max-height:none">${shown.map(queueRowHTML).join('')}</ol>
        <button type="button" class="btn small ghost" data-act="queueExpand">전체 ${rows.length}곡 펼치기 ▾</button>`
    } else if (mobile) {
      list = `<ol class="q-list" style="max-height:none">${rows.map(queueRowHTML).join('')}</ol>
        ${rows.length > 5 ? '<button type="button" class="btn small ghost" data-act="queueExpand">접기 ▴</button>' : ''}`
    } else {
      list = `<div class="scroll-shell"><ol class="q-list scroll-area" data-scroll="queue" aria-label="곡 목록">${rows.map(queueRowHTML).join('')}</ol></div><p class="more-hint" data-more-for="queue"></p>`
    }
    void cur
    return `<section class="w-queue" aria-label="지금 재생목록">
      <div class="q-head"><div style="min-width:0">${head}</div>${switcher}</div>
      ${notice}${list}<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between">${footer}</div></section>`
  }

  function queueRowHTML({ t, i, current, played, idle }) {
    return `<li><button type="button" class="q-row ${current ? 'is-current' : ''} ${played ? 'is-played' : ''}" data-act="${idle ? 'playSelIndex' : 'jump'}" data-i="${i}" ${current ? 'aria-current="true"' : ''}>
      <span class="no">${pad2(i + 1)}</span><span class="t">${esc(t.title)}</span><span class="state">${current ? (S.playing ? '♪ 재생 중' : '❚❚ 멈춤') : ''}</span></button></li>`
  }

  function popoverHTML() {
    const many = S.playlists.length > 8
    const q = S.plQuery.trim().toLowerCase()
    const list = S.playlists.filter((p) => q === '' || p.name.toLowerCase().includes(q))
    return `<div class="popover" role="dialog" aria-label="다른 목록 재생">
      <p class="eyebrow">다른 목록 재생</p>
      ${many ? `<input class="field" type="search" placeholder="목록 이름 찾기 (${S.playlists.length}개)" data-bind="plQuery" data-rerender="1" value="${esc(S.plQuery)}" />` : ''}
      <ul class="p-list scroll-area">${list
        .map(
          (p) => `<li><button type="button" class="p-row ${S.queueSource?.playlistId === p.id ? 'is-on' : ''}" data-act="playList" data-id="${p.id}" ${p.tracks.length === 0 ? 'disabled' : ''}>
          <span>${esc(p.name)}<br /><small>${p.tracks.length}곡${S.queueSource?.playlistId === p.id ? ' · 지금 재생 중' : ''}</small></span><span aria-hidden="true">▶</span></button></li>`,
        )
        .join('')}</ul>
      <div style="display:flex;justify-content:space-between"><button type="button" class="linkish" data-act="arch" data-v="music">보관함에서 관리 ↗</button><button type="button" class="btn small ghost" data-act="popover">닫기</button></div></div>`
  }

  /* ── Moments 위젯 (이 곡) — 대시보드와 A/B 비교가 같은 그리기를 쓴다 ── */

  function momentCtx(key) {
    if (key === 'dash') {
      const cur = currentTrack()
      return {
        ...dash,
        model: S.momentModel,
        song: cur,
        time: S.time,
        reliable: cur !== null && S.started,
        moments: S.moments,
        total: S.moments.length,
      }
    }
    const ab = S.ab[key.slice(2)]
    return { ...ab, reliable: true, total: ab.moments.length }
  }
  const ctxState = (key) => (key === 'dash' ? dash : S.ab[key.slice(2)])
  const ctxMoments = (key) => (key === 'dash' ? S.moments : S.ab[key.slice(2)].moments)

  function momentsWidgetHTML(key, width = 1321) {
    const c = momentCtx(key)
    const mobile = width <= 700
    const song = c.song
    const mine = song ? c.moments.filter((m) => m.videoId === song.videoId).sort((a, b) => a.atSeconds - b.atSeconds) : []
    const draft = c.draft
    const capLabel = c.model === 'B' && draft ? '↻ 시점 다시 잡기' : '＋ 이 순간 저장'
    let card = ''
    if (c.model === 'B' && draft) {
      card = `<div class="m-card is-draft" role="group" aria-label="저장 전 Moment">
        <div class="state-line"><span>${fmt(draft.atSeconds)}${draft.videoId !== song?.videoId ? ` · 이전 곡 ‘${esc(draft.title.slice(0, 18))}…’` : ''}</span>
        <span class="state-chip ${c.fail ? 'fail' : 'draft'}">${c.fail ? '저장 못 함' : '아직 저장 안 됨'}</span></div>
        ${c.fail ? '<p class="toast">다른 39page 탭이 저장하는 중이에요. 잠시 뒤 다시 눌러 주세요 — 입력한 메모는 남아 있어요.</p>' : ''}
        <label class="label" for="${key}-note">메모 (선택)</label>
        <textarea id="${key}-note" class="field" data-bind="note" data-ctx="${key}" placeholder="이 순간에 대해 한 줄 (Enter = 저장, Shift+Enter = 줄바꿈)">${esc(draft.note)}</textarea>
        <div class="row-actions"><button type="button" class="btn small ghost" data-act="mCancel" data-ctx="${key}">취소 (저장 안 함)</button>
        <button type="button" class="btn small primary" data-act="mSave" data-ctx="${key}">◆ Moment 저장</button></div></div>`
    }
    if (c.model === 'A' && c.noteFor) {
      const m = c.moments.find((x) => x.id === c.noteFor)
      if (m)
        card = `<div class="m-card" role="group" aria-label="저장된 Moment 의 메모">
          <div class="state-line"><span>${fmt(m.atSeconds)}</span><span class="state-chip saved">✓ 저장됨</span></div>
          <label class="label" for="${key}-note">메모 추가 (선택) — 이미 저장된 Moment 에 붙어요</label>
          <textarea id="${key}-note" class="field" data-bind="noteA" data-ctx="${key}" placeholder="이 순간에 대해 한 줄 (Enter = 메모 저장)">${esc(m.note)}</textarea>
          <div class="row-actions"><button type="button" class="btn small ghost" data-act="mSkip" data-ctx="${key}">메모 없이 닫기</button>
          <button type="button" class="btn small primary" data-act="mNote" data-ctx="${key}">메모 저장</button></div></div>`
    }
    if (c.model === 'A' && c.fail && !c.noteFor)
      card = `<div class="m-card"><div class="state-line"><span>${fmt(c.time)}</span><span class="state-chip fail">저장 못 함</span></div><p class="toast">다른 39page 탭이 저장하는 중이에요. 다시 누르면 지금 시점으로 저장해요.</p></div>`

    // 지금 시점 표시 — 시점 순 목록 사이에 "지금" 선
    const rowsHTML = []
    let markerPlaced = false
    for (const m of mine) {
      if (!markerPlaced && song && m.atSeconds > c.time) {
        rowsHTML.push(`<li class="now-marker" aria-hidden="true">지금 ${fmt(c.time)}</li>`)
        markerPlaced = true
      }
      rowsHTML.push(`<li class="m-row ${m.id === c.justSaved ? 'is-new' : ''}" data-mid="${m.id}">
        <button type="button" class="seek" data-act="mPlay" data-ctx="${key}" data-id="${m.id}" aria-label="${fmt(m.atSeconds)} 부터 재생">▶ ${fmt(m.atSeconds)}</button>
        <span class="note ${m.note ? '' : 'empty-note'}">${m.note ? esc(m.note) : '메모 없음'}${m.id === c.justSaved ? '<span class="badge">방금 저장</span>' : ''}</span></li>`)
    }
    if (song && !markerPlaced && mine.length > 0) rowsHTML.push(`<li class="now-marker" aria-hidden="true">지금 ${fmt(c.time)}</li>`)

    let list
    if (!song) list = `<p class="empty">곡을 재생하면 지금 이 순간을 저장할 수 있어요.</p>`
    else if (mine.length === 0) list = `<p class="empty">이 곡의 Moment 가 아직 없어요. 좋은 순간에 ＋ 를 눌러 보세요.</p>`
    else if (mobile) {
      const expanded = S.momentsExpanded
      const shownRows = expanded ? rowsHTML : rowsHTML.slice(0, 4)
      list = `<ol class="m-list" style="max-height:none">${shownRows.join('')}</ol>${rowsHTML.length > 4 ? `<button type="button" class="btn small ghost" data-act="momentsExpand">${expanded ? '접기 ▴' : `이 곡 Moments ${mine.length}개 모두 보기 ▾`}</button>` : ''}`
    } else
      list = `<div class="scroll-shell"><ol class="m-list scroll-area" data-scroll="${key}-moments">${rowsHTML.join('')}</ol></div><p class="more-hint" data-more-for="${key}-moments"></p>`

    return `<section class="w-moments" aria-label="이 곡의 Moments">
      <div class="m-head"><div style="min-width:0"><p class="widget-title">MOMENTS · 이 곡 <span class="q-meta">${song ? `${mine.length}개` : ''}</span></p>
        <p class="m-song">${song ? esc(song.title) : '재생 중인 곡 없음'}</p></div>
        ${key === 'dash' ? `<button type="button" class="btn small" data-act="arch" data-v="moments">모두 보기 (${c.total}) ↗</button>` : ''}</div>
      <button type="button" class="capture" data-act="capture" data-ctx="${key}" ${!c.reliable ? 'disabled' : ''}><span>${capLabel}</span><span class="at" data-live="time" data-ctx="${key}">${song ? fmt(c.time) : '–:––'}</span></button>
      ${card}<p class="toast" role="status" data-toast="${key}">${esc(c.toast ?? '')}</p>${list}</section>`
  }

  /* ── 보관함 ── */

  function archiveHTML(width, landscapeLow) {
    const narrow = width <= 700 || landscapeLow
    const tabs = `<div class="arch-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${S.archTab === 'music'}" data-act="tab" data-v="music">♪ 음악</button>
      <button type="button" role="tab" aria-selected="${S.archTab === 'moments'}" data-act="tab" data-v="moments">◆ Moments ${S.moments.length}</button></div>`
    const body = S.archTab === 'music' ? musicHTML(narrow) : momentsTabHTML()
    return `<aside class="archive" aria-label="보관함"><div class="arch-head"><span class="title">보관함</span>${tabs}
      <button type="button" class="icon-btn" data-act="archClose" aria-label="보관함 닫기">×</button></div>
      <div class="arch-body">${body}</div></aside>`
  }

  function musicHTML(narrow) {
    const sel = playlistById(S.selectedId)
    const step = narrow ? `step-${S.mStep}` : ''
    const q = S.plQuery.trim().toLowerCase()
    const visible = S.playlists.filter((p) => q === '' || p.name.toLowerCase().includes(q))
    const listCol = `<div class="pl-col">
      <div class="pl-col-head"><p class="section-title">플레이리스트 ${S.playlists.length}</p><button type="button" class="btn small primary" data-act="plCreate">＋ 새 목록</button></div>
      ${S.plCreate ? `<div style="padding:0 12px 8px"><div class="inline-form"><input class="field" data-bind="newName" placeholder="새 목록 이름" value="" /><button type="button" class="btn small primary" data-act="plCreateOk">만들고 링크 추가</button><button type="button" class="btn small ghost" data-act="plCreate">취소</button></div></div>` : ''}
      ${S.playlists.length > 8 ? `<div class="pl-search"><input class="field" type="search" placeholder="목록 이름 찾기" data-bind="plQuery" data-rerender="1" value="${esc(S.plQuery)}" /></div>` : ''}
      <ul class="pl-list scroll-area" data-scroll="pl">${visible.map((p) => plItemHTML(p)).join('') || '<li class="empty">맞는 목록이 없어요.</li>'}</ul></div>`
    const detail = sel === undefined ? `<div class="detail"><p class="empty" style="margin:12px">목록을 고르거나 새로 만드세요.</p></div>` : detailHTML(sel, narrow)
    return `<div class="music ${step}">${listCol}${detail}</div>`
  }

  function plItemHTML(p) {
    const selected = p.id === S.selectedId
    const playing = S.queueSource?.playlistId === p.id
    let extra = ''
    if (S.plMenu === p.id)
      extra = `<div class="more-menu" role="menu"><button type="button" class="menu-item" role="menuitem" data-act="plRename" data-id="${p.id}">이름 바꾸기</button><div class="menu-sep"></div><button type="button" class="menu-item danger" role="menuitem" data-act="plDelete" data-id="${p.id}">목록 삭제…</button></div>`
    const rename =
      S.plRename === p.id
        ? `<div class="inline-form" style="grid-column:1/-1"><input class="field" data-bind="rename" value="${esc(p.name)}" /><button type="button" class="btn small primary" data-act="plRenameOk" data-id="${p.id}">저장</button><button type="button" class="btn small ghost" data-act="plRename" data-id="">취소</button></div>`
        : ''
    const confirm =
      S.plConfirm === p.id
        ? `<div class="confirm" role="alert">‘${esc(p.name)}’ 과 곡 ${p.tracks.length}개를 지울까요? Moments 는 남아요.<button type="button" class="btn small danger" data-act="plDeleteOk" data-id="${p.id}">삭제</button><button type="button" class="btn small ghost" data-act="plDelete" data-id="">취소</button></div>`
        : ''
    return `<li class="pl-item ${selected ? 'is-selected' : ''}">
      <button type="button" class="pl-row" data-act="select" data-id="${p.id}" ${selected ? 'aria-current="true"' : ''}>
        <span class="n">${esc(p.name)}</span><span class="meta">${p.tracks.length}곡${playing ? ' · <span class="playing">♪ 재생 중인 목록</span>' : ''}</span></button>
      <button type="button" class="icon-btn" data-act="plMenu" data-id="${p.id}" aria-label="‘${esc(p.name)}’ 관리" aria-haspopup="menu" aria-expanded="${S.plMenu === p.id}">⋯</button>
      ${extra}${rename}${confirm}</li>`
  }

  function detailHTML(sel, narrow) {
    const playing = S.queueSource?.playlistId === sel.id
    const back = narrow ? `<button type="button" class="btn small ghost" data-act="mStep" data-v="list">‹ 목록</button>` : ''
    const crumb = narrow ? `<p class="crumb">보관함 › 음악 › ${esc(sel.name)}</p>` : ''
    const editable = modeAllowsEdit(S.reorder)
    const head = `<div class="detail-head"><div style="min-width:0;flex:1 1 220px">${back}${crumb}<h3>${esc(sel.name)}</h3>
        <p class="q-meta">${sel.tracks.length}곡${playing ? ' · ♪ 지금 재생 중인 목록' : ''}</p></div>
      <div class="actions"><button type="button" class="btn small primary" data-act="playDetail" ${sel.tracks.length === 0 ? 'disabled' : ''}>▶ 전체 재생</button>
        <button type="button" class="btn small" data-act="addOpen" aria-expanded="${S.addOpen}">＋ 링크 추가</button>
        ${editable ? `<button type="button" class="btn small ${S.editMode ? 'primary' : 'ghost'}" data-act="editMode">${S.editMode ? '완료' : '편집'}</button>` : ''}</div></div>`
    const add = S.addOpen
      ? `<form class="add-form" data-form="add"><label class="label" for="add-url">YouTube 링크 — 추가한 뒤에도 칸이 남아 이어서 넣을 수 있어요</label>
        <div class="row"><input id="add-url" class="field" data-bind="addUrl" placeholder="https://www.youtube.com/watch?v=…" value="" />
        <input class="field" data-bind="addTitle" placeholder="제목 (링크를 넣으면 자동으로 채워져요)" value="" /></div>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn small ghost" data-act="addOpen">닫기</button><button type="submit" class="btn small primary">추가</button></div>
        <p class="toast" data-toast="add">${esc(S.addToast ?? '')}</p></form>`
      : ''
    const editBar =
      S.editMode
        ? `<div class="edit-bar"><span>편집 중 — ≡ 를 끌어 순서를 바꾸거나 ↑ ↓ 로 옮겨요. 재생은 잠시 쉬어요(목록의 ▶ 숨김).</span><button type="button" class="btn small primary" data-act="editMode">완료</button></div>`
        : ''
    const listKey = `lib:${sel.id}`
    const rows = sel.tracks.length === 0 ? '<li class="empty">아직 곡이 없어요. ＋ 링크 추가로 넣어 보세요.</li>' : sel.tracks.map((t, i) => trackRowHTML(listKey, t, i, sel.tracks.length, S.reorder, S.editMode, narrow)).join('')
    return `<div class="detail">${head}${add}${editBar}<ol class="t-list scroll-area" data-list="${listKey}" data-scroll="tracks">${rows}</ol></div>`
  }

  const modeAllowsEdit = (mode) => mode === 'B' || mode === 'C'

  /** 트랙 한 줄 — 보관함 상세와 정렬 비교가 같은 그리기를 쓴다. mode: A 핸들+메뉴 · B 편집 모드 · C 혼합. */
  function trackRowHTML(listKey, t, i, count, mode, editing, touch) {
    const cur = currentTrack()
    const isCur = listKey.startsWith('lib:') && cur !== null && cur.id === t.id
    const grabbed = S.grab && S.grab.list === listKey && S.grab.id === t.id
    const showHandle = mode === 'A' || editing || (mode === 'C' && !touch)
    const showPlay = !editing
    const showMenu = !editing && (mode === 'A' || mode === 'C')
    const handle = showHandle
      ? `<button type="button" class="handle" data-handle="1" data-list="${listKey}" data-id="${t.id}" aria-label="${i + 1}번째 ‘${esc(t.title.slice(0, 30))}’ 옮기기 — 스페이스로 잡고 화살표로 이동" aria-pressed="${!!grabbed}">≡</button>`
      : '<span></span>'
    const play = showPlay
      ? `<button type="button" class="t-play" data-act="playTrack" data-list="${listKey}" data-id="${t.id}" aria-label="‘${esc(t.title.slice(0, 30))}’ 재생">▶</button>`
      : '<span></span>'
    let tail = ''
    if (editing) {
      tail = `<span class="edit-tools">
        <button type="button" class="icon-btn" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="up" aria-label="위로" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="down" aria-label="아래로" ${i === count - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn" data-act="tRename" data-list="${listKey}" data-id="${t.id}" aria-label="이름 바꾸기">✎</button>
        <button type="button" class="icon-btn danger" data-act="tDelete" data-list="${listKey}" data-id="${t.id}" aria-label="삭제">✕</button></span>`
    } else if (showMenu) {
      tail = `<button type="button" class="icon-btn" data-act="tMenu" data-list="${listKey}" data-id="${t.id}" aria-label="‘${esc(t.title.slice(0, 30))}’ 관리" aria-haspopup="menu" aria-expanded="${S.trMenu === listKey + t.id}">⋯</button>`
    }
    let menu = ''
    if (S.trMenu === listKey + t.id)
      menu = `<div class="more-menu" role="menu" style="right:4px">
        <button type="button" class="menu-item" role="menuitem" data-act="tRename" data-list="${listKey}" data-id="${t.id}">이름 바꾸기</button>
        <div class="menu-sep"></div>
        <button type="button" class="menu-item" role="menuitem" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="top" ${i === 0 ? 'disabled' : ''}>⤒ 맨 위로</button>
        <button type="button" class="menu-item" role="menuitem" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="up" ${i === 0 ? 'disabled' : ''}>↑ 위로</button>
        <button type="button" class="menu-item" role="menuitem" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="down" ${i === count - 1 ? 'disabled' : ''}>↓ 아래로</button>
        <button type="button" class="menu-item" role="menuitem" data-act="tMove" data-list="${listKey}" data-id="${t.id}" data-v="bottom" ${i === count - 1 ? 'disabled' : ''}>⤓ 맨 아래로</button>
        <div class="menu-sep"></div>
        <button type="button" class="menu-item danger" role="menuitem" data-act="tDelete" data-list="${listKey}" data-id="${t.id}">곡 삭제…</button></div>`
    const rename =
      S.trRename === listKey + t.id
        ? `<div class="inline-form" style="grid-column:1/-1"><input class="field" data-bind="rename" value="${esc(t.title)}" /><button type="button" class="btn small primary" data-act="tRenameOk" data-list="${listKey}" data-id="${t.id}">저장</button><button type="button" class="btn small ghost" data-act="tRename" data-list="" data-id="">취소</button></div>`
        : ''
    const confirm =
      S.trConfirm === listKey + t.id
        ? `<div class="confirm" role="alert">이 곡을 목록에서 지울까요? Moments 는 남아요.<button type="button" class="btn small danger" data-act="tDeleteOk" data-list="${listKey}" data-id="${t.id}">삭제</button><button type="button" class="btn small ghost" data-act="tDelete" data-list="" data-id="">취소</button></div>`
        : ''
    return `<li class="t-item ${isCur ? 'is-current' : ''} ${grabbed ? 'is-grabbed' : ''}" data-id="${t.id}">
      ${handle}${play}<span class="t"><span class="no" aria-hidden="true">${pad2(i + 1)}</span> ${esc(t.title)}${isCur ? `<small>${S.playing ? '♪ 재생 중' : '❚❚ 멈춤'}</small>` : ''}</span>${tail}${menu}${rename}${confirm}</li>`
  }

  function momentsTabHTML() {
    const cur = currentTrack()
    const groups = new Map()
    for (const m of S.moments) {
      if (S.momChip === 'song' && cur && m.videoId !== cur.videoId) continue
      if (!groups.has(m.videoId)) groups.set(m.videoId, [])
      groups.get(m.videoId).push(m)
    }
    const chips = `<div class="chips"><button type="button" data-act="chip" data-v="all" aria-pressed="${S.momChip === 'all'}">전체</button><button type="button" data-act="chip" data-v="recent" aria-pressed="${S.momChip === 'recent'}">최근</button><button type="button" data-act="chip" data-v="song" aria-pressed="${S.momChip === 'song'}">이 곡</button></div>`
    return `<div class="moments-tab scroll-area" data-scroll="mtab"><input class="field" type="search" placeholder="검색: 제목 · 메모" />${chips}
      <p class="q-meta">M11-4 의 Moments 보관함 그대로 (이번 시안에서 바꾸지 않음). 다른 곡의 Moments 검색 · 정리 · 삭제는 여기서.</p>
      ${[...groups.entries()]
        .map(
          ([, ms]) => `<div class="group"><h4>▾ ${esc(ms[0].title)} <small>· ${ms.length}개${cur && ms[0].videoId === cur.videoId ? ' · 재생 중' : ''}</small></h4>
        ${ms
          .sort((a, b) => a.atSeconds - b.atSeconds)
          .map((m) => `<div class="m-row"><button type="button" class="seek" data-act="mPlay" data-ctx="dash" data-id="${m.id}">▶ ${fmt(m.atSeconds)}</button><span class="note ${m.note ? '' : 'empty-note'}">${m.note ? esc(m.note) : '메모 없음'}</span></div>`)
          .join('')}</div>`,
        )
        .join('')}</div>`
  }

  function dataDialogHTML() {
    return `<div style="position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:var(--overlay-background-color)">
      <div role="dialog" aria-label="데이터" style="width:min(420px,92%);padding:16px;border:1px solid var(--modal-border-color);background:var(--modal-surface-color);box-shadow:var(--modal-shadow)">
      <h3 style="margin:0 0 8px">데이터 · 백업</h3><p class="q-meta">라이브러리 정상 · Moments 정상</p>
      <p style="font-size:13px">플레이리스트 ${S.playlists.length}개 · 곡 ${S.playlists.reduce((n, p) => n + p.tracks.length, 0)}개 · Moments ${S.moments.length}개</p>
      <button type="button" class="btn primary" style="width:100%;margin-bottom:6px">JSON 백업 내보내기</button><button type="button" class="btn ghost" style="width:100%">JSON 백업 가져오기…</button>
      <p class="q-meta">M11-2 의 데이터 대화상자 그대로 (시안 — 동작 없음)</p><button type="button" class="btn small" data-act="data">닫기</button></div></div>`
  }

  /* ── 대시보드 한 장 ── */

  function appHTML(width, height) {
    const landscapeLow = height <= 560 && width > height
    let ws
    if (S.archOpen) {
      const archive = archiveHTML(width, landscapeLow)
      const archH = Math.max(320, height - (width <= 700 ? 0 : 180))
      if (S.layout === 'C' && width > 700 && !landscapeLow) {
        ws = `<div class="open-grid layout-C" style="--arch-h:${Math.max(300, height - 430)}px">${playerHTML({ strip: true })}${archive}</div>`
      } else if (S.layout === 'B' && width > 700 && !landscapeLow) {
        ws = `<div class="open-grid layout-B" style="--arch-h:${archH}px"><div class="left-col">${playerHTML()}${momentsWidgetHTML('dash', width)}</div>${archive}</div>`
      } else {
        ws = `<div class="open-grid layout-A" style="--arch-h:${archH}px;--arch-h-mobile:${Math.max(320, height - 330)}px">${playerHTML()}${archive}</div>`
      }
    } else {
      const order = width <= 700 ? `order-${S.order === 'M2' ? 'm2' : S.order === 'now' ? 'now' : 'm1'}` : ''
      ws = `<div class="host ${order}" style="--queue-h:${height <= 800 ? 260 : 340}px;--moments-h:${height <= 800 ? 210 : 280}px">
        ${deckHTML()}${miniDeckHTML()}${playerHTML()}${clockHTML()}${weatherHTML()}${momentsWidgetHTML('dash', width)}${queueWidgetHTML(width)}${mascotHTML()}</div>`
    }
    return `<div class="app ${landscapeLow ? 'is-landscape-low' : ''}" style="--h:${height}px"><div class="shell">${headerHTML(width)}
      <div class="workspace">${ws}</div></div>${S.dataOpen ? dataDialogHTML() : ''}</div>`
  }

  function deviceHTML(width, height, label, opts = {}) {
    return `<figure class="frame-wrap" style="margin:0"><div class="device-scaler" data-scaler data-w="${width}" data-h="${height}" data-fit="${opts.fit ?? S.fit}">
      <div class="device" style="--w:${width}px;--h:${height}px">${appHTML(width, height)}</div></div>
      <figcaption>${esc(label)}</figcaption></figure>`
  }

  /* ───────────────────────── 화면들 ───────────────────────── */

  const SIZES = [
    [1440, 900, '1440×900'],
    [1321, 761, '1321×761 (UAT)'],
    [1024, 768, '1024×768'],
    [390, 844, '390 세로'],
    [360, 740, '360 세로'],
    [844, 390, '844×390 가로'],
  ]

  function seg(act, value, current, label, rec) {
    return `<button type="button" class="seg" data-act="${act}" data-v="${value}" aria-pressed="${String(current) === String(value)}">${label}${rec ? '<span class="rec">추천</span>' : ''}</button>`
  }

  function controlsDashboard() {
    return `<fieldset><legend>보기</legend>${seg('variant', 'proposed', S.variant, '제안 (M11-7)', true)}${seg('variant', 'current', S.variant, '지금 (M11-6 스크린샷)')}</fieldset>
      <fieldset><legend>화면 크기</legend>${SIZES.map(([w, h, l]) => seg('size2', `${w}x${h}`, `${S.w}x${S.h}`, l)).join('')}${seg('fit', S.fit ? '0' : '1', 'x', S.fit ? '실제 크기로' : '화면에 맞추기')}</fieldset>
      <fieldset><legend>헤더</legend>${seg('header', 'H1', S.header, 'H1 보관함·데이터·테마', true)}${seg('header', 'H2', S.header, 'H2 좁으면 더보기')}${seg('header', 'now', S.header, '지금 음악·Moments·데이터')}</fieldset>
      <fieldset><legend>보관함</legend>${seg('archSet', 'off', S.archOpen ? S.archTab : 'off', '닫힘')}${seg('archSet', 'music', S.archOpen ? S.archTab : 'off', '음악')}${seg('archSet', 'moments', S.archOpen ? S.archTab : 'off', 'Moments')}</fieldset>
      <fieldset><legend>보관함 열림 배치</legend>${seg('layout', 'A', S.layout, 'A 지금 + 안쪽 2열')}${seg('layout', 'B', S.layout, 'B 재생 열 유지', true)}${seg('layout', 'C', S.layout, 'C 작은 영상 띠')}</fieldset>
      <fieldset><legend>Moment 저장</legend>${seg('mm', 'A', S.momentModel, 'A 바로 저장')}${seg('mm', 'B', S.momentModel, 'B 잡고 저장', true)}</fieldset>
      <fieldset><legend>데이터 양</legend>${seg('dsize', 'uat', S.size, 'UAT 11목록·22곡')}${seg('dsize', 'few', S.size, '3목록 1·10·30곡')}${seg('dsize', 'many', S.size, '50목록·100곡')}${seg('dsize', 'empty', S.size, '빈 상태')}</fieldset>
      <fieldset><legend>시나리오</legend><button type="button" class="seg" data-act="scenarioReorder">재생 중인 목록 순서 바꾸기</button><button type="button" class="seg" data-act="scenarioSelect">보관함에서 다른 목록 고르기</button>${seg('hit', S.showHit ? '0' : '1', 'x', S.showHit ? '데크 누름 영역 숨기기' : '데크 누름 영역 보기')}</fieldset>`
  }

  function screenDashboard() {
    if (S.variant === 'current') return screenCurrent()
    const note = `<p class="proto-note"><b>대시보드 = 듣기와 빠른 조작.</b> ${deckWord()} 아래의 <b>NOW PLAYLIST</b> 는 <b>지금 재생 큐</b>(재생을 시작할 때의 스냅샷)를 보여 주고, 큐가 비어 있을 때만 보관함에서 고른 목록을 "재생 대기" 로 보여 줍니다. 오른쪽 <b>MOMENTS · 이 곡</b> 은 지금 곡의 Moments 를 시점 순으로 안쪽 스크롤 안에 모두 보여 줍니다(모바일은 펼치기). 헤더는 <b>보관함 · 데이터 · 테마</b> 셋. 숫자는 1초마다 흐르는 가짜 재생입니다.</p>`
    return note + `<div class="frames">${deviceHTML(S.w, S.h, `${S.w}×${S.h} · ${S.archOpen ? `보관함 열림 · 배치 ${S.layout}` : '대시보드'} · ${isMono() ? 'Mono Vinyl' : 'Synth Cassette'}`)}</div>`
  }

  function screenCurrent() {
    const t = isMono() ? 'mono' : 'kawaii'
    const shots = [
      [`screenshots/now-${t}-1321-dashboard.png`, `지금 (M11-6) · 1321×761 · 대시보드 — PLAYLISTS 카드 6개 + "모든 목록 보기", Moments 는 이 곡 미리보기 3개`],
      [`screenshots/now-${t}-1321-archive-music.png`, '지금 · 보관함 음악 탭 — 목록 11개가 위에 쌓여 고른 목록의 곡이 화면 아래로 밀림, 데크 · 시계 · Moments 사라짐'],
      [`screenshots/now-${t}-1321-archive-moments.png`, '지금 · 보관함 Moments 탭'],
      ['screenshots/now-mono-390-dashboard-full.png', '지금 · 390 세로 전체 — LP 가 영상보다 먼저'],
    ]
    return `<p class="proto-note"><b>지금(M11-6) 화면 — 실제 앱을 격리 프로필 · 샘플 데이터(목록 11 · 곡 22 · Moments 11)로 찍은 스크린샷</b>입니다. YouTube · 날씨 요청은 막았습니다(영상 자리가 비어 있는 이유).</p>
      <div class="frames">${shots.map(([src, cap]) => `<figure class="frame-wrap" style="margin:0;max-width:${src.includes('390') ? 300 : 900}px"><img class="shot" src="${src}" alt="${esc(cap)}" /><figcaption>${esc(cap)}</figcaption></figure>`).join('')}</div>`
  }

  function controlsArchive() {
    return `<fieldset><legend>보관함 열림 배치</legend>${seg('layout', 'A', S.layout, 'A 지금 + 안쪽 2열')}${seg('layout', 'B', S.layout, 'B 재생 열 유지', true)}${seg('layout', 'C', S.layout, 'C 작은 영상 띠')}</fieldset>
      <fieldset><legend>트랙 편집</legend>${seg('ro', 'A', S.reorder, 'A 핸들+메뉴')}${seg('ro', 'B', S.reorder, 'B 편집 모드')}${seg('ro', 'C', S.reorder, 'C 혼합', true)}</fieldset>
      <fieldset><legend>데이터 양</legend>${seg('dsize', 'uat', S.size, 'UAT 11목록')}${seg('dsize', 'few', S.size, '3목록 1·10·30곡')}${seg('dsize', 'many', S.size, '50목록·100곡')}${seg('dsize', 'empty', S.size, '빈 상태')}</fieldset>
      <fieldset><legend>모바일 단계</legend>${seg('mStep', 'list', S.mStep, '1 목록')}${seg('mStep', 'detail', S.mStep, '2 상세')}</fieldset>`
  }

  function screenArchive() {
    S.archOpen = true
    S.archTab = 'music'
    return `<p class="proto-note"><b>음악 보관함 = 관리.</b> 데스크톱은 <b>왼쪽 목록(만들기 · 고르기 · ⋯ 이름 바꾸기 · 삭제)</b> 과 <b>오른쪽 상세(▶ 전체 재생 · ＋ 링크 추가 · 곡 편집)</b> 를 나눠 각자 스크롤합니다 — 목록이 50개여도 곡이 아래로 밀리지 않습니다. "♪ 재생 중인 목록" 표시(글)와 "고른 목록" 강조(테두리)는 다른 모양입니다. 모바일은 목록 → 상세 두 단계, ‹ 목록 으로 돌아옵니다. <b>링크 추가</b> 는 추가한 뒤에도 칸이 남아 이어서 넣습니다.</p>
      <div class="frames">${deviceHTML(1321, 761, '1321×761 · 보관함 음악 탭', { fit: true })}${deviceHTML(390, 844, '390 세로 · 영상 아래 시트 · 목록 → 상세', { fit: false })}${deviceHTML(1280, 620, '낮은 데스크톱 1280×620', { fit: true })}</div>`
  }

  function controlsMoments() {
    return `<fieldset><legend>실패 흉내</legend><button type="button" class="seg" data-act="failNext" data-ctx="abA">A: 다음 저장 실패</button><button type="button" class="seg" data-act="failNext" data-ctx="abB">B: 다음 저장 실패</button></fieldset>
      <fieldset><legend>곡 바뀜 흉내</legend><button type="button" class="seg" data-act="abSong" data-ctx="abA">A 다음 곡</button><button type="button" class="seg" data-act="abSong" data-ctx="abB">B 다음 곡</button></fieldset>
      <fieldset><legend>처음으로</legend><button type="button" class="seg" data-act="abReset">초기화</button></fieldset>`
  }

  function screenMoments() {
    const col = (model, title, steps, recNote) => {
      const ctx = S.ab[model]
      return `<section><h3><span class="proto-tag ${model === 'B' ? 'rec' : ''}">${model}</span>${title}</h3><ol class="steps">${steps}</ol>
        <div class="sim-player"><button type="button" class="btn small" data-act="abToggle" data-ctx="ab${model}">${ctx.playing ? '❚❚' : '▶'}</button><span class="grow">${esc(ctx.song.title)}</span><span data-live="time" data-ctx="ab${model}">${fmt(ctx.time)}</span></div>
        ${momentsWidgetHTML(`ab${model}`, 400)}
        <div class="metric"><span>누른 횟수 <b>${ctx.clicks}</b></span><span>저장소 쓰기 <b>${ctx.writes}</b></span><span>Moments <b>${ctx.moments.length}</b></span></div>
        <ul class="log" aria-label="${model} 기록">${ctx.log.map((l) => `<li>${esc(l)}</li>`).join('') || '<li>(아직 없음)</li>'}</ul><p class="proto-note" style="margin-top:8px">${recNote}</p></section>`
    }
    return `<p class="proto-note"><b>Moment 저장 두 모델을 직접 눌러 비교하세요.</b> 두 칸은 같은 곡을 따로 재생하는 흉내입니다. 오른쪽 아래 기록에 "저장소에 실제로 쓰는 순간" 이 남습니다. 어느 쪽도 확정하지 않았습니다 — 실제 store 동작은 바뀌지 않았습니다.</p>
      <div class="compare">
      ${col('A', '바로 저장 + 메모 자동 열림', '<li>＋ 이 순간 저장 → <b>그 순간 저장됨</b> (✓ 저장됨)</li><li>메모 칸이 저절로 열림 — 쓰면 저장된 Moment 를 고침</li><li>"메모 없이 닫기" 해도 Moment 는 남음</li>', '메모 없이 1번, 메모까지 2번 + 입력. 잘못 누르면 지워야 함(보관함). 연속 저장은 1번씩.')}
      ${col('B', '시점 잡기 + 최종 저장', '<li>＋ 이 순간 저장 → <b>시점만 잡힘</b> (아직 저장 안 됨)</li><li>메모를 쓰거나 비운 채 ◆ Moment 저장 → 그때 처음 저장</li><li>취소하면 아무것도 남지 않음 · 곡이 바뀌어도 잡은 시점은 유지</li>', '메모 없이 2번, 메모까지 2번 + 입력(Enter). 잘못 누름 = 취소 1번. 확장 패널과 같은 흐름.')}
      </div>
      <h3 class="proto-h">비교</h3><div class="scroll-x"><table class="proto-table"><thead><tr><th>기준</th><th>A 바로 저장</th><th>B 잡고 저장 (추천)</th></tr></thead><tbody>
      <tr><td>시점 정확성</td><td>누른 순간 확정</td><td>누른 순간 확정 (저장을 늦게 눌러도 잡은 시점)</td></tr>
      <tr><td>상태의 명확성</td><td class="bad">"저장됐는데 메모 칸이 열림" — 지금 저장 중인지 고치는 중인지 헷갈림 (U1)</td><td class="good">점선 카드 = 아직 저장 안 됨 · 실선 + ✓ = 저장됨</td></tr>
      <tr><td>메모 없이 저장</td><td class="good">1번</td><td>2번 (또는 잡은 뒤 Enter)</td></tr>
      <tr><td>메모와 함께</td><td>2번 + 입력</td><td>2번 + 입력 (Enter 로 저장)</td></tr>
      <tr><td>취소의 뜻</td><td class="bad">메모만 취소 — Moment 는 남음</td><td class="good">아무것도 안 남음</td></tr>
      <tr><td>잘못 누름</td><td class="bad">데이터가 생김 → 보관함에서 삭제</td><td class="good">취소 1번 · 그냥 두어도 저장 안 됨</td></tr>
      <tr><td>연속 저장</td><td class="good">1번씩</td><td>2번씩 (잡기 → 저장)</td></tr>
      <tr><td>저장 실패 · 다른 탭</td><td>실패하면 Moment 가 없고 메모 칸도 열리지 않음</td><td class="good">카드와 메모가 남아 "다시 저장" 가능</td></tr>
      <tr><td>잊어버림</td><td class="good">이미 저장됨</td><td class="bad">저장을 안 누르면 남지 않음 → 카드가 곡이 바뀌어도 남고 "아직 저장 안 됨" 을 표시</td></tr>
      <tr><td>확장 패널과 일관성</td><td class="bad">다름 (패널은 잡고 저장)</td><td class="good">같음 (ADR 0028 결정 15)</td></tr>
      <tr><td>모바일</td><td>저장 직후 키보드가 올라와 영상을 가릴 수 있음</td><td>잡은 뒤 키보드 — 같은 문제. 메모 칸은 자동 포커스하지 않고 누를 때만</td></tr>
      </tbody></table></div>`
  }

  function controlsReorder() {
    return `<fieldset><legend>기기</legend>${seg('roDevice', 'desktop', S.roDevice, '데스크톱 (마우스·키보드)')}${seg('roDevice', 'touch', S.roDevice, '모바일 (터치 흉내)')}</fieldset>
      <fieldset><legend>처음으로</legend><button type="button" class="seg" data-act="roReset">초기화</button></fieldset>`
  }

  function screenReorder() {
    const touch = S.roDevice === 'touch'
    const col = (mode, title, steps, note) => {
      const list = S.ro[mode]
      const key = `ro:${mode}`
      const editing = S.ro.edit[mode]
      const editBtn =
        mode === 'B' || (mode === 'C' && touch)
          ? `<button type="button" class="btn small ${editing ? 'primary' : 'ghost'}" data-act="roEdit" data-v="${mode}">${editing ? '완료' : '편집'}</button>`
          : ''
      return `<section class="${touch ? 'touch-sim' : ''}"><h3><span class="proto-tag ${mode === 'C' ? 'rec' : ''}">${mode}</span>${title}</h3><ol class="steps">${steps}</ol>
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="q-meta">10곡 · 누른 횟수 ${S.ro.clicks[mode]}</span>${editBtn}</div>
        <ol class="t-list scroll-area" data-list="${key}" style="max-height:470px;padding:8px 4px 8px 0">${list.map((t, i) => trackRowHTML(key, t, i, list.length, mode, editing, touch)).join('')}</ol>
        <p class="proto-note" style="margin-top:8px">${note}</p></section>`
    }
    return `<p class="proto-note"><b>곡 순서 바꾸기 · 이름 바꾸기 · 삭제.</b> ≡ 를 마우스 · 손가락으로 끌거나, ≡ 에 포커스를 두고 <span class="kbd">Space</span> 로 잡은 뒤 <span class="kbd">↑</span><span class="kbd">↓</span> <span class="kbd">Home</span><span class="kbd">End</span> 로 옮기고 <span class="kbd">Space</span> 로 놓습니다(<span class="kbd">Esc</span> = 되돌리기). 결과는 화면 낭독기에도 알립니다. "모바일" 을 고르면 손가락 크기 · 편집 모드 흐름을 흉내 냅니다(실제 터치 기기에서도 동작).</p>
      <div class="compare">
      ${col('A', '드래그 핸들 + 관리 메뉴', '<li>≡ 끌기 = 순서</li><li>⋯ = 이름 바꾸기 · 맨 위/위/아래/맨 아래 · 삭제</li><li>▶ 와 ≡ 가 떨어져 있어 끌다 재생하지 않음</li>', '발견하기 쉬움. 모바일에서는 핸들이 늘 있어 줄이 붐비고, 핸들 밖을 끌면 스크롤이 됨.')}
      ${col('B', '명시적 편집 모드', '<li>평소: ▶ 와 제목만 — 듣기 화면</li><li>편집: ≡ · ↑ ↓ · ✎ · ✕(삭제) 가 보이고 ▶ 가 숨음</li><li>완료 → 듣기로</li>', '실수로 지우기 가장 어려움. 한 곡만 옮겨도 편집 → 끌기 → 완료 3단계.')}
      ${col('C', '혼합 — 데스크톱 끌기 · 모바일 편집 모드', '<li>데스크톱: ≡ 끌기 + ⋯ 메뉴(키보드로 맨 위/아래까지)</li><li>모바일: 편집 버튼 → ≡ · ↑ ↓ · ✎ · ✕</li><li>키보드: ≡ 에서 Space · 화살표</li>', '추천. 기기마다 자연스러운 방식, 키보드 · 낭독기 경로가 둘(≡ 잡기 · ⋯ 메뉴).')}
      </div>
      <h3 class="proto-h">비교</h3><div class="scroll-x"><table class="proto-table"><thead><tr><th>기준</th><th>A</th><th>B</th><th>C (추천)</th></tr></thead><tbody>
      <tr><td>한 곡을 5칸 올리기</td><td class="good">끌기 1번</td><td>편집 · 끌기 · 완료 = 3번</td><td class="good">데스크톱 1번 · 모바일 3번</td></tr>
      <tr><td>맨 위로</td><td>⋯ → 맨 위로 = 2번</td><td>편집 · 끌기 · 완료</td><td>⋯ → 맨 위로 = 2번</td></tr>
      <tr><td>지금(M11-6) 대비</td><td colspan="3">지금: 관리 → 위로 × 5 = 6번 (한 칸씩)</td></tr>
      <tr><td>발견 가능성</td><td class="good">≡ 가 늘 보임</td><td>"편집" 글자로 찾음</td><td class="good">데스크톱 ≡ · 모바일 "편집"</td></tr>
      <tr><td>긴 제목</td><td>핸들 · ▶ · ⋯ 가 폭을 씀</td><td class="good">평소엔 제목이 넓음</td><td>데스크톱 A 와 같음 · 모바일은 B</td></tr>
      <tr><td>터치 · 스크롤 충돌</td><td class="bad">핸들 밖 끌기 = 스크롤, 핸들 = 끌기 — 핸들이 작으면 오조작</td><td class="good">편집 중에만 끌기</td><td class="good">편집 중에만 끌기</td></tr>
      <tr><td>44px 터치</td><td>≡ · ▶ · ⋯ 각 44px</td><td>편집 도구 각 44px</td><td>같음</td></tr>
      <tr><td>실수로 삭제</td><td>메뉴 → 확인 = 2단계</td><td>✕ → 확인</td><td>메뉴 → 확인 · 편집 중 ✕ → 확인</td></tr>
      <tr><td>키보드 · 낭독기</td><td>≡ Space+화살표 · ⋯ 메뉴</td><td>↑ ↓ 단추</td><td class="good">≡ Space+화살표 · ⋯ 메뉴 · 편집 ↑ ↓</td></tr>
      <tr><td>끄는 중 재생 변경</td><td colspan="3">끌기는 ≡ 에서만 시작하고 ▶ 와 겹치지 않음. 놓을 때 한 번만 저장 — 끄는 동안 큐 · 재생은 그대로</td></tr>
      <tr><td>여러 탭 동시 수정</td><td colspan="3">놓을 때 "그 곡을 n번째로" 한 번 쓴다(탭 간 잠금 · 개정 번호 그대로). 다른 탭이 먼저 바꿨으면 지금처럼 거절 → 새로 읽고 다시</td></tr>
      </tbody></table></div>`
  }

  function controlsMobile() {
    return `<fieldset><legend>모바일 순서</legend>${seg('order', 'M1', S.order, 'M1 영상 먼저', true)}${seg('order', 'M2', S.order, 'M2 작은 데크 띠')}${seg('order', 'now', S.order, '지금 (데크 먼저)')}</fieldset>
      <fieldset><legend>헤더</legend>${seg('header', 'H1', S.header, 'H1', true)}${seg('header', 'H2', S.header, 'H2 더보기')}</fieldset>
      <fieldset><legend>보관함</legend>${seg('archSet', 'off', S.archOpen ? S.archTab : 'off', '닫힘')}${seg('archSet', 'music', S.archOpen ? S.archTab : 'off', '음악')}</fieldset>
      <fieldset><legend>보관함 단계</legend>${seg('mStep', 'list', S.mStep, '1 목록')}${seg('mStep', 'detail', S.mStep, '2 상세')}</fieldset>
      <fieldset><legend>Moment 저장</legend>${seg('mm', 'A', S.momentModel, 'A')}${seg('mm', 'B', S.momentModel, 'B', true)}</fieldset>`
  }

  function screenMobile() {
    return `<p class="proto-note"><b>모바일.</b> M1 은 <b>영상 → 이 곡 Moments(저장) → 지금 재생목록 → 데크</b> 순서입니다. 모바일의 위젯은 <b>안쪽 스크롤을 쓰지 않습니다</b>(M11-3 에서 페이지 스크롤과 겹쳤던 문제) — 지금 곡 주변 5곡 · Moments 4개만 보이고 "펼치기" 로 늘립니다. 보관함은 영상 아래 시트에서 목록 → 상세. 가로(844×390)는 영상 왼쪽 · 보관함 오른쪽.</p>
      <div class="frames">${deviceHTML(360, 740, '360×740 세로', { fit: false })}${deviceHTML(390, 844, '390×844 세로', { fit: false })}${deviceHTML(844, 390, '844×390 가로', { fit: false })}</div>`
  }

  function screenDecisions() {
    const rows = [
      ['1', 'PLAYLISTS 카드 위젯', '없앤다 → <b>NOW PLAYLIST</b>(지금 큐)로 바꾼다. 목록 바꾸기는 위젯의 "목록 바꾸기 ▾"', '카드 위젯을 남기고 안쪽 스크롤만 추가 — 고른 목록과 재생 큐가 계속 섞여 보임'],
      ['2', 'NOW PLAYLIST 가 보여 줄 것', '<b>큐가 있으면 큐</b>(스냅샷, 출처 목록 이름) · 없으면 고른 목록을 "재생 대기" 로. 마지막 재생 목록은 저장하지 않음(새로고침 뒤엔 대기)', '고른 목록을 늘 보여 줌 — 듣는 곡이 목록에 없을 수 있음 / 마지막 재생 목록을 저장 — 저장 키 추가(승인 필요)'],
      ['3', '보관함 열림 배치', '<b>B 재생 열 유지</b> — 왼쪽: 영상 + 조작 + 이 곡 Moments(캡처) / 오른쪽: 보관함 2열', 'A 지금 그대로(캡처 불가) / C 작은 영상 띠(356×200, 하한에 붙음)'],
      ['4', 'Moment 저장', '<b>B 잡고 저장</b> (확장 패널과 같음)', 'A 바로 저장 — 1번에 끝나지만 U1 의 혼란이 그대로'],
      ['5', '트랙 편집', '<b>C 혼합</b> — 데스크톱 ≡ 끌기 + ⋯ 메뉴 · 모바일 편집 모드 · 키보드 Space+화살표. 라이브러리 없이 직접 구현', 'A 늘 핸들 / B 늘 편집 모드 / SortableJS 도입'],
      ['6', '헤더', '<b>H1</b> — ▤ 보관함 · ⇩ 데이터 · 백업 · 테마 (모든 폭에서 글자)', 'H2 — 좁은 화면에서 데이터 · 테마를 ⋯ 더보기로(발견성 낮음)'],
      ['7', '모바일 순서', '<b>M1</b> — 영상 → 이 곡 Moments → 지금 재생목록 → 데크 → 시계 · 날씨 → 마스코트', 'M2 — 작은 데크 띠를 영상 위에(아트를 잘라 씀 · 승인 필요) / 지금 — 데크 먼저'],
      ['8', '데크', '본체 = 음악 보관함(그 목록), 아트의 재생 키 = 재생/일시정지. 누름 영역을 겹치지 않게 다시 잰다', '데크 본체 = 재생/일시정지로 바꾸고 보관함은 헤더만'],
    ]
    return `<p class="proto-note"><b>사용자가 고를 것.</b> 아래 추천은 확정이 아닙니다(문서 <span class="kbd">docs/product/M11_7_UX_REDESIGN.md</span> §12 · ADR 0030 Proposed).</p>
      <div class="scroll-x"><table class="proto-table"><thead><tr><th>#</th><th>결정</th><th>추천</th><th>대안</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table></div>`
  }

  const SCREENS = {
    dashboard: ['1 대시보드', controlsDashboard, screenDashboard],
    archive: ['2 음악 보관함', controlsArchive, screenArchive],
    moments: ['3 Moment 저장 A/B', controlsMoments, screenMoments],
    reorder: ['4 트랙 정렬', controlsReorder, screenReorder],
    mobile: ['5 모바일', controlsMobile, screenMobile],
    decisions: ['6 결정표', () => '', screenDecisions],
  }

  /* ───────────────────────── 그리기 ───────────────────────── */

  const root = document.getElementById('proto')
  let focusKey = null

  function render() {
    deckSeq = 0
    document.documentElement.dataset.theme = S.theme
    const scr = SCREENS[S.screen] ?? SCREENS.dashboard
    const scrolls = new Map()
    for (const el of document.querySelectorAll('[data-scroll]')) scrolls.set(el.dataset.scroll, el.scrollTop)
    root.innerHTML = `
      <nav class="proto-nav" aria-label="시안 화면">${Object.entries(SCREENS)
        .map(([k, [label]]) => `<a href="#/${k}" data-act="screen" data-v="${k}" ${k === S.screen ? 'aria-current="page"' : ''}>${label}</a>`)
        .join('')}</nav>
      <div class="proto-controls">${scr[1]()}</div>
      <main class="proto-stage">${scr[2]()}</main>`
    document.getElementById('themeLabel').textContent = isMono() ? 'Mono Vinyl' : 'Synth Cassette'
    for (const el of document.querySelectorAll('[data-scroll]')) {
      if (scrolls.has(el.dataset.scroll)) el.scrollTop = scrolls.get(el.dataset.scroll)
    }
    fitDevices()
    wireScrollHints()
    revealCurrent()
    if (focusKey !== null) {
      const el = document.querySelector(focusKey)
      if (el) el.focus({ preventScroll: true })
      focusKey = null
    }
    writeHash()
  }

  function softRender() {
    const a = document.activeElement
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) {
      updateLive()
      return
    }
    render()
  }

  function fitDevices() {
    const avail = root.querySelector('.proto-stage').clientWidth - 4
    for (const sc of document.querySelectorAll('[data-scaler]')) {
      const w = Number(sc.dataset.w)
      const h = Number(sc.dataset.h)
      const fit = sc.dataset.fit === 'true'
      const dev = sc.firstElementChild
      const scale = fit && w > avail ? avail / w : 1
      dev.style.transform = scale === 1 ? '' : `scale(${scale})`
      sc.style.width = `${w * scale + 2}px`
      sc.style.height = `${h * scale + 2}px`
    }
  }

  function wireScrollHints() {
    for (const el of document.querySelectorAll('.scroll-area[data-scroll]')) {
      const shell = el.parentElement?.classList.contains('scroll-shell') ? el.parentElement : null
      const hint = document.querySelector(`[data-more-for="${el.dataset.scroll}"]`)
      const update = () => {
        const above = el.scrollTop > 2
        const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2
        shell?.classList.toggle('more-above', above)
        shell?.classList.toggle('more-below', below)
        if (hint) {
          const rows = [...el.children].filter((li) => !li.classList.contains('now-marker'))
          const box = el.getBoundingClientRect()
          const hidden = rows.filter((li) => li.getBoundingClientRect().top >= box.bottom - 4).length
          const hiddenUp = rows.filter((li) => li.getBoundingClientRect().bottom <= box.top + 4).length
          hint.textContent = [hiddenUp > 0 ? `↑ 위에 ${hiddenUp}개` : '', hidden > 0 ? `아래에 ${hidden}개 더 ↓` : ''].filter(Boolean).join(' · ')
        }
      }
      el.addEventListener('scroll', update, { passive: true })
      update()
    }
  }

  /** 지금 곡 · 방금 저장한 Moment 를 그 칸 안에서만 보이게 한다 (페이지는 움직이지 않는다). */
  function revealCurrent() {
    for (const el of document.querySelectorAll('.scroll-area[data-scroll]')) {
      const target = el.querySelector('.is-current, .is-new')
      if (!target || el.dataset.revealed === target.dataset.mid + (target.dataset.id ?? '')) continue
      const top = target.offsetTop - el.offsetTop
      if (top < el.scrollTop || top + target.offsetHeight > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 3)
      }
    }
  }

  const live = () => document.getElementById('live')
  function say(text) {
    live().textContent = ''
    setTimeout(() => (live().textContent = text), 30)
    S.lastSay = text
  }

  /* ───────────────────────── 동작 ───────────────────────── */

  function listByKey(key) {
    if (key.startsWith('lib:')) return playlistById(key.slice(4))?.tracks
    if (key.startsWith('ro:')) return S.ro[key.slice(3)]
    return undefined
  }

  function moveTo(key, id, to) {
    const list = listByKey(key)
    if (!list) return
    const from = list.findIndex((t) => t.id === id)
    if (from === -1) return
    const clamped = Math.max(0, Math.min(list.length - 1, to))
    if (clamped === from) return
    const [item] = list.splice(from, 1)
    list.splice(clamped, 0, item)
    say(`‘${item.title.slice(0, 24)}’ ${from + 1}번째 → ${clamped + 1}번째`)
  }

  function momentCapture(key) {
    const st = ctxState(key)
    const c = momentCtx(key)
    if (!c.reliable || !c.song) return
    st.clicks += 1
    st.toast = ''
    if (c.model === 'A') {
      if (st.noteFor) commitNoteA(key) // 열려 있던 메모는 그대로 남긴다
      if (st.failNext) {
        st.failNext = false
        st.fail = true
        st.noteFor = null
        st.log.unshift(`${fmt(c.time)} 저장 실패 — 다른 탭이 저장 중 (쓰기 없음)`)
        return
      }
      st.fail = false
      const m = { id: uid('m'), videoId: c.song.videoId, atSeconds: Math.floor(c.time), note: '', title: c.song.title }
      ctxMoments(key).push(m)
      st.writes += 1
      st.justSaved = m.id
      st.noteFor = m.id
      st.log.unshift(`쓰기 #${st.writes}: Moment 생성 ${fmt(m.atSeconds)} (메모 없음)`)
      st.toast = `${fmt(m.atSeconds)} 저장했어요.`
      say(st.toast)
      focusKey = `#${key}-note`
    } else {
      st.fail = false
      if (st.draft) {
        st.draft.atSeconds = Math.floor(c.time)
        st.draft.videoId = c.song.videoId
        st.draft.title = c.song.title
        st.log.unshift(`시점 다시 잡음 ${fmt(c.time)} (쓰기 없음)`)
      } else {
        st.draft = { videoId: c.song.videoId, title: c.song.title, atSeconds: Math.floor(c.time), note: '' }
        st.log.unshift(`시점 잡음 ${fmt(c.time)} — 아직 저장 안 됨 (쓰기 없음)`)
      }
      say(`${fmt(c.time)} 시점을 잡았어요. 메모를 쓰고 Moment 저장을 누르세요.`)
    }
  }

  function commitNoteA(key) {
    const st = ctxState(key)
    const m = ctxMoments(key).find((x) => x.id === st.noteFor)
    const typed = st.noteDraft
    if (m && typeof typed === 'string' && typed !== m.note) {
      m.note = typed
      st.writes += 1
      st.log.unshift(`쓰기 #${st.writes}: 메모 갱신 ${fmt(m.atSeconds)} — “${typed.slice(0, 20)}”`)
    }
    st.noteDraft = undefined
  }

  function momentSaveB(key) {
    const st = ctxState(key)
    if (!st.draft) return
    st.clicks += 1
    if (st.failNext) {
      st.failNext = false
      st.fail = true
      st.log.unshift(`저장 실패 ${fmt(st.draft.atSeconds)} — 카드 · 메모 유지 (쓰기 없음)`)
      say('저장하지 못했어요. 메모는 남아 있어요.')
      return
    }
    const d = st.draft
    const m = { id: uid('m'), videoId: d.videoId, atSeconds: d.atSeconds, note: d.note, title: d.title }
    ctxMoments(key).push(m)
    st.writes += 1
    st.fail = false
    st.draft = null
    st.justSaved = m.id
    st.log.unshift(`쓰기 #${st.writes}: Moment 생성 ${fmt(m.atSeconds)}${m.note ? ` — “${m.note.slice(0, 20)}”` : ' (메모 없음)'}`)
    st.toast = `${fmt(m.atSeconds)} Moment 를 저장했어요.`
    say(st.toast)
  }

  const ACTIONS = {
    screen: (v) => {
      S.screen = v
      S.popover = false
      if (v === 'dashboard' || v === 'mobile') S.archOpen = false
    },
    theme: (v) => {
      S.theme = v
      S.moreMenu = false
    },
    variant: (v) => (S.variant = v),
    size2: (v) => {
      const [w, h] = v.split('x').map(Number)
      S.w = w
      S.h = h
    },
    fit: (v) => (S.fit = v === '1'),
    header: (v) => (S.header = v),
    archSet: (v) => {
      S.archOpen = v !== 'off'
      if (S.archOpen) S.archTab = v
    },
    arch: (v) => {
      S.popover = false
      S.moreMenu = false
      if (v === 'last') {
        S.archOpen = !S.archOpen
        return
      }
      if (S.archOpen && S.archTab === v && S.header === 'now') S.archOpen = false
      else {
        S.archOpen = true
        S.archTab = v
        if (v === 'music' && S.queueSource) {
          S.selectedId = S.queueSource.playlistId
          S.mStep = 'detail'
        }
      }
    },
    archClose: () => (S.archOpen = false),
    tab: (v) => (S.archTab = v),
    layout: (v) => (S.layout = v),
    order: (v) => (S.order = v),
    mm: (v) => {
      S.momentModel = v
      Object.assign(dash, { draft: null, noteFor: null, fail: false })
    },
    ro: (v) => {
      S.reorder = v
      S.editMode = false
    },
    dsize: (v) => {
      S.size = v
      resetData()
    },
    hit: (v) => (S.showHit = v === '1'),
    data: () => {
      S.dataOpen = !S.dataOpen
      S.moreMenu = false
    },
    moreMenu: () => (S.moreMenu = !S.moreMenu),
    toggle: () => {
      if (currentTrack() === null) return
      S.playing = !S.playing
    },
    play: () => {
      if (currentTrack()) S.playing = true
    },
    pause: () => (S.playing = false),
    next: () => {
      if (!jumpQueue(S.queueIndex + 1)) S.status = '목록의 마지막 곡이에요.'
    },
    prev: () => {
      if (S.time > 3) S.time = 0
      else jumpQueue(S.queueIndex - 1)
    },
    jump: (v, el) => jumpQueue(Number(el.dataset.i)),
    playSelIndex: (v, el) => {
      const sel = playlistById(S.selectedId) ?? S.playlists[0]
      startQueue(sel, Number(el.dataset.i))
    },
    playSel: () => {
      const sel = playlistById(S.selectedId) ?? S.playlists[0]
      if (sel.tracks.length) startQueue(sel, 0)
    },
    popover: () => {
      S.popover = !S.popover
      S.plQuery = ''
    },
    playList: (v, el) => {
      const p = playlistById(el.dataset.id)
      if (p && p.tracks.length) startQueue(p, 0)
      S.popover = false
      say(`‘${p.name}’ 을 처음부터 재생해요.`)
    },
    resync: () => resyncQueue(),
    editSource: () => {
      S.archOpen = true
      S.archTab = 'music'
      S.selectedId = S.queueSource.playlistId
      S.mStep = 'detail'
    },
    editSelected: () => {
      S.archOpen = true
      S.archTab = 'music'
      S.mStep = 'detail'
    },
    createFromEmpty: () => {
      S.archOpen = true
      S.archTab = 'music'
      S.plCreate = true
      S.mStep = 'list'
    },
    queueExpand: () => (S.queueExpanded = !S.queueExpanded),
    momentsExpand: () => (S.momentsExpanded = !S.momentsExpanded),
    scenarioReorder: () => {
      const p = playlistById(S.queueSource?.playlistId)
      if (!p || p.tracks.length < 2) return
      const [first] = p.tracks.splice(0, 1)
      p.tracks.push(first)
      say(`보관함에서 ‘${p.name}’ 의 첫 곡을 맨 아래로 옮겼어요 (다른 탭에서 한 것처럼).`)
    },
    scenarioSelect: () => {
      const other = S.playlists.find((p) => p.id !== S.queueSource?.playlistId && p.id !== S.selectedId)
      if (other) S.selectedId = other.id
      S.archOpen = true
      S.archTab = 'music'
    },
    // 보관함 음악
    select: (v, el) => {
      S.selectedId = el.dataset.id
      S.mStep = 'detail'
      S.plMenu = null
      S.editMode = false
      S.addOpen = false
    },
    mStep: (v) => (S.mStep = v),
    plMenu: (v, el) => (S.plMenu = S.plMenu === el.dataset.id ? null : el.dataset.id),
    plRename: (v, el) => {
      S.plRename = el.dataset.id || null
      S.plMenu = null
      if (S.plRename) focusKey = '.pl-item .inline-form .field'
    },
    plRenameOk: (v, el) => {
      const p = playlistById(el.dataset.id)
      if (p && S.renameDraft?.trim()) p.name = S.renameDraft.trim()
      if (S.queueSource?.playlistId === p?.id) S.queueSource.name = p.name
      S.plRename = null
      S.renameDraft = undefined
    },
    plDelete: (v, el) => {
      S.plConfirm = el.dataset.id || null
      S.plMenu = null
    },
    plDeleteOk: (v, el) => {
      S.playlists = S.playlists.filter((p) => p.id !== el.dataset.id)
      if (S.selectedId === el.dataset.id) S.selectedId = S.playlists[0]?.id ?? null
      S.plConfirm = null
      S.mStep = 'list'
    },
    plCreate: () => {
      S.plCreate = !S.plCreate
      if (S.plCreate) focusKey = '.pl-col .inline-form .field'
    },
    plCreateOk: () => {
      const name = (S.newName ?? '').trim() || `새 목록 ${S.playlists.length + 1}`
      const p = { id: uid('p'), name, tracks: [] }
      S.playlists.unshift(p)
      S.selectedId = p.id
      S.plCreate = false
      S.newName = ''
      S.addOpen = true
      S.mStep = 'detail'
      focusKey = '#add-url'
    },
    playDetail: () => {
      const p = playlistById(S.selectedId)
      if (p?.tracks.length) startQueue(p, 0)
    },
    addOpen: () => {
      S.addOpen = !S.addOpen
      S.addToast = ''
      if (S.addOpen) focusKey = '#add-url'
    },
    editMode: () => {
      S.editMode = !S.editMode
      S.trMenu = null
    },
    playTrack: (v, el) => {
      if (S.dragging) return
      const key = el.dataset.list
      if (key.startsWith('ro:')) {
        S.ro.clicks[key.slice(3)] += 1
        say('(정렬 비교에서는 재생하지 않아요)')
        return
      }
      const p = playlistById(key.slice(4))
      startQueue(p, p.tracks.findIndex((t) => t.id === el.dataset.id))
    },
    tMenu: (v, el) => {
      const k = el.dataset.list + el.dataset.id
      S.trMenu = S.trMenu === k ? null : k
      if (el.dataset.list.startsWith('ro:')) S.ro.clicks[el.dataset.list.slice(3)] += 1
    },
    tMove: (v, el) => {
      const key = el.dataset.list
      const list = listByKey(key)
      const from = list.findIndex((t) => t.id === el.dataset.id)
      const to = v === 'top' ? 0 : v === 'bottom' ? list.length - 1 : v === 'up' ? from - 1 : from + 1
      moveTo(key, el.dataset.id, to)
      S.trMenu = null
      if (key.startsWith('ro:')) S.ro.clicks[key.slice(3)] += 1
      focusKey = `[data-act="tMove"][data-id="${el.dataset.id}"][data-v="${v}"]`
    },
    tRename: (v, el) => {
      S.trRename = el.dataset.list ? el.dataset.list + el.dataset.id : null
      S.trMenu = null
      if (S.trRename) focusKey = '.t-item .inline-form .field'
    },
    tRenameOk: (v, el) => {
      const t = listByKey(el.dataset.list)?.find((x) => x.id === el.dataset.id)
      if (t && S.renameDraft !== undefined) t.title = S.renameDraft.trim() || `YouTube · ${t.videoId}`
      S.trRename = null
      S.renameDraft = undefined
    },
    tDelete: (v, el) => {
      S.trConfirm = el.dataset.list ? el.dataset.list + el.dataset.id : null
      S.trMenu = null
    },
    tDeleteOk: (v, el) => {
      const list = listByKey(el.dataset.list)
      const i = list.findIndex((t) => t.id === el.dataset.id)
      if (i !== -1) list.splice(i, 1)
      S.trConfirm = null
      if (el.dataset.list.startsWith('ro:')) S.ro.clicks[el.dataset.list.slice(3)] += 1
    },
    chip: (v) => (S.momChip = v),
    // Moments
    capture: (v, el) => momentCapture(el.dataset.ctx),
    mSave: (v, el) => momentSaveB(el.dataset.ctx),
    mCancel: (v, el) => {
      const st = ctxState(el.dataset.ctx)
      st.clicks += 1
      st.draft = null
      st.fail = false
      st.log.unshift('취소 — 아무것도 저장하지 않음')
      say('취소했어요. 저장하지 않았어요.')
    },
    mNote: (v, el) => {
      const st = ctxState(el.dataset.ctx)
      st.clicks += 1
      commitNoteA(el.dataset.ctx)
      st.noteFor = null
      st.toast = '메모를 저장했어요.'
    },
    mSkip: (v, el) => {
      const st = ctxState(el.dataset.ctx)
      st.clicks += 1
      st.noteFor = null
      st.noteDraft = undefined
      st.log.unshift('메모 없이 닫음 — Moment 는 남음')
    },
    mPlay: (v, el) => {
      const key = el.dataset.ctx
      const m = ctxMoments(key).find((x) => x.id === el.dataset.id)
      if (!m) return
      if (key === 'dash') playMomentDash(m)
      else {
        S.ab[key.slice(2)].time = m.atSeconds
        S.ab[key.slice(2)].playing = true
      }
    },
    failNext: (v, el) => (ctxState(el.dataset.ctx).failNext = true),
    abSong: (v, el) => {
      const ab = S.ab[el.dataset.ctx.slice(2)]
      const n = SONGS.indexOf(ab.song.title) + 1
      ab.song = { videoId: VID(n % SONGS.length), title: SONGS[n % SONGS.length] }
      ab.time = 0
      ab.log.unshift(`곡 바뀜 → ${ab.song.title.slice(0, 24)}`)
    },
    abToggle: (v, el) => {
      const ab = S.ab[el.dataset.ctx.slice(2)]
      ab.playing = !ab.playing
    },
    abReset: () => resetAB(),
    roDevice: (v) => (S.roDevice = v),
    roEdit: (v) => {
      S.ro.edit[v] = !S.ro.edit[v]
      S.ro.clicks[v] += 1
    },
    roReset: () => resetReorder(),
  }

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]')
    if (!el) {
      if (S.popover || S.moreMenu || S.plMenu || S.trMenu) {
        if (!event.target.closest('.popover, .more-menu')) {
          S.popover = false
          S.moreMenu = false
          S.plMenu = null
          S.trMenu = null
          render()
        }
      }
      return
    }
    if (el.tagName === 'A') event.preventDefault()
    const fn = ACTIONS[el.dataset.act]
    if (!fn) return
    if (el.dataset.act !== 'plMenu' && el.dataset.act !== 'tMenu') {
      if (!['plRename', 'plDelete', 'tRename', 'tDelete', 'tMove'].includes(el.dataset.act)) {
        S.plMenu = null
        S.trMenu = null
      }
    }
    fn(el.dataset.v, el)
    render()
  })

  document.addEventListener('input', (event) => {
    const el = event.target
    const bind = el.dataset?.bind
    if (!bind) return
    if (bind === 'note') ctxState(el.dataset.ctx).draft.note = el.value
    else if (bind === 'noteA') ctxState(el.dataset.ctx).noteDraft = el.value
    else if (bind === 'rename') S.renameDraft = el.value
    else S[bind] = el.value
    if (el.dataset.rerender) {
      const pos = el.selectionStart
      render()
      const again = document.querySelector(`[data-bind="${bind}"]`)
      if (again) {
        again.focus()
        again.setSelectionRange(pos, pos)
      }
    }
  })

  document.addEventListener('submit', (event) => {
    if (event.target.dataset.form !== 'add') return
    event.preventDefault()
    const url = (S.addUrl ?? '').trim()
    const m = /(?:v=|youtu\.be\/)([\w-]{11})/.exec(url)
    if (!m) {
      S.addToast = 'YouTube 영상 링크가 아니에요. watch?v= 또는 youtu.be/ 주소를 넣어 주세요.'
    } else {
      const p = playlistById(S.selectedId)
      const title = (S.addTitle ?? '').trim() || `(시안) 링크에서 가져온 제목 · ${m[1]}`
      p.tracks.push({ id: uid('t'), videoId: m[1], title })
      S.addToast = `‘${title.slice(0, 30)}’ 을 ${p.tracks.length}번째로 담았어요. 다음 링크를 이어서 넣으세요.`
    }
    S.addUrl = ''
    S.addTitle = ''
    focusKey = '#add-url'
    render()
  })

  document.addEventListener('keydown', (event) => {
    const el = event.target
    // Moment 메모: Enter = 저장, Shift+Enter = 줄바꿈, Esc = 취소/닫기
    if (el.dataset?.bind === 'note' || el.dataset?.bind === 'noteA') {
      const key = el.dataset.ctx
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (el.dataset.bind === 'note') momentSaveB(key)
        else ACTIONS.mNote(null, el)
        render()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (el.dataset.bind === 'note') ACTIONS.mCancel(null, el)
        else ACTIONS.mSkip(null, el)
        render()
      }
      return
    }
    // 키보드 정렬: ≡ 에서 Space 로 잡고 화살표로 옮긴다
    if (el.dataset?.handle) {
      const key = el.dataset.list
      const id = el.dataset.id
      const list = listByKey(key)
      const index = list.findIndex((t) => t.id === id)
      const grabbed = S.grab && S.grab.list === key && S.grab.id === id
      const refocus = () => (focusKey = `.handle[data-list="${key}"][data-id="${id}"]`)
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (grabbed) {
          S.grab = null
          say(`놓았어요 — ${index + 1}번째`)
        } else {
          S.grab = { list: key, id, from: index }
          say(`잡았어요 — ${index + 1}번째. 화살표로 옮기고 스페이스로 놓으세요. Esc 는 되돌리기.`)
        }
        refocus()
        render()
      } else if (grabbed && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : list.length - 1
        moveTo(key, id, to)
        if (key.startsWith('ro:')) S.ro.clicks[key.slice(3)] += 1
        refocus()
        render()
      } else if (grabbed && event.key === 'Escape') {
        event.preventDefault()
        moveTo(key, id, S.grab.from)
        S.grab = null
        say('되돌렸어요.')
        refocus()
        render()
      }
      return
    }
    if (event.key === 'Escape') {
      if (S.popover || S.moreMenu || S.plMenu || S.trMenu || S.dataOpen) {
        S.popover = false
        S.moreMenu = false
        S.plMenu = null
        S.trMenu = null
        S.dataOpen = false
        render()
      }
    }
  })

  /* ── 포인터 끌기 (마우스 · 터치 · 펜) — ≡ 에서만 시작한다 ── */

  let drag = null
  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.handle')
    if (!handle) return
    const row = handle.closest('.t-item')
    const listEl = row.parentElement
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    drag = { handle, row, listEl, key: handle.dataset.list, id: handle.dataset.id, moved: false, startY: event.clientY }
  })

  document.addEventListener('pointermove', (event) => {
    if (!drag) return
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return
    if (!drag.moved) {
      drag.moved = true
      S.dragging = true
      drag.row.classList.add('is-dragging')
    }
    const rows = [...drag.listEl.children].filter((r) => r !== drag.row && r.classList.contains('t-item'))
    let before = null
    for (const r of rows) {
      const box = r.getBoundingClientRect()
      if (event.clientY < box.top + box.height / 2) {
        before = r
        break
      }
    }
    if (before) drag.listEl.insertBefore(drag.row, before)
    else drag.listEl.appendChild(drag.row)
    // 칸 끝에 가까우면 그 칸만 스크롤한다 (페이지는 그대로)
    const lb = drag.listEl.getBoundingClientRect()
    if (event.clientY < lb.top + 36) drag.listEl.scrollTop -= 10
    if (event.clientY > lb.bottom - 36) drag.listEl.scrollTop += 10
  })

  function endDrag() {
    if (!drag) return
    const d = drag
    drag = null
    if (d.moved) {
      const order = [...d.listEl.children].filter((r) => r.classList.contains('t-item')).map((r) => r.dataset.id)
      moveTo(d.key, d.id, order.indexOf(d.id))
      if (d.key.startsWith('ro:')) S.ro.clicks[d.key.slice(3)] += 1
      setTimeout(() => (S.dragging = false), 0)
      render()
    } else S.dragging = false
  }
  document.addEventListener('pointerup', endDrag)
  document.addEventListener('pointercancel', endDrag)

  window.addEventListener('resize', fitDevices)
  window.addEventListener('hashchange', () => {
    const before = S.size
    readHash()
    if (S.size !== before) resetData()
    render()
  })

  document.getElementById('themeToggle').addEventListener('click', (event) => {
    event.stopPropagation()
    S.theme = isMono() ? 'kawaii-synth-cassette' : 'mono-vinyl'
    render()
  })

  /* ───────────────────────── 시작 ───────────────────────── */

  readHash()
  resetData()
  resetReorder()
  resetAB()
  render()
})()
