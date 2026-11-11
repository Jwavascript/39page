/**
 * M11-1 저장 브리지 PoC — YouTube 위 플로팅 패널 (확장 페이지, iframe 안).
 *
 * ⚠ 실험 코드. 화면 설계는 `docs/product/M11_UX_DESIGN.md` §8 의 축소판이다.
 *
 * 지키는 것
 * - 사용자가 누를 때만 쓴다. 패널을 연 것만으로 저장하지 않는다.
 * - **저장 확인 전에는 성공이라 하지 않는다.** 브리지가 저장소를 다시 읽어 확인한 응답만 "저장됨".
 * - 응답을 잃으면(시간 초과 · 워커 재시작) 같은 쓰기를 다시 보내기 전에 **저장 여부를 먼저
 *   조회**한다 (`track/find` · `moment/find`). 확인되면 "저장됨", 아니면 새 요청으로 다시.
 * - 목록은 만들었는데 곡을 못 담으면(부분 성공) 전체 성공이라 하지 않고 **그 목록에** 다시 담는다.
 * - 브리지를 쓸 수 없으면 M10 수집 화면(새 탭)으로 넘긴다 — 검증된 대체 경로.
 */
import { NS, WRITE_START_WINDOW_MS } from './protocol.js'

const $ = (selector) => document.querySelector(selector)
const params = new URLSearchParams(location.search)

const state = {
  route: 'offscreen',
  video: null,
  lists: [],
  frozenAt: null,
  busy: false,
  lastOutcome: null,
  log: [],
}
globalThis.__panel = state // 하네스가 CDP 로 읽는다

const formatTime = (s) =>
  s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function debug(line) {
  state.log.push(`${new Date().toISOString().slice(11, 23)} ${line}`)
  $('#debug').textContent = state.log.slice(-12).join('\n')
}

function send(message) {
  return chrome.runtime.sendMessage({ ns: NS, v: 1, ...message })
}

/** 브리지 호출. 응답 · 전송 오류를 한 모양으로. 던지지 않는다. */
async function call(payload, id = crypto.randomUUID(), route = state.route) {
  const request = { id, deadline: Date.now() + WRITE_START_WINDOW_MS, payload }
  const started = performance.now()
  try {
    const reply = await send({ type: 'bridge/call', route, request })
    const ms = Math.round(performance.now() - started)
    if (reply?.transport === 'ok') {
      debug(`${payload.op} ${reply.response.ok ? 'ok' : reply.response.error.code} ${ms}ms`)
      return { kind: 'response', id, ms, response: reply.response }
    }
    debug(`${payload.op} transport ${reply?.code ?? 'no-reply'} ${ms}ms`)
    return { kind: 'transport', id, ms, code: reply?.code ?? 'no-reply' }
  } catch (error) {
    // 응답 전에 워커가 사라지면 "message port closed …" 로 거절된다.
    debug(`${payload.op} worker-gone ${String(error).slice(0, 80)}`)
    return { kind: 'transport', id, code: 'worker-gone' }
  }
}

// 하네스 전용 — 같은 ID 재전송 · 두 경로 동시 저장을 직접 만든다.
state.call = call

/* ------------------------------ 결과 표시 ------------------------------ */

function showResult(kind, lines, actions = []) {
  const box = $('#result')
  box.dataset.state = kind
  box.replaceChildren()
  for (const line of lines) {
    const p = document.createElement('p')
    p.textContent = line // 텍스트로만 그린다
    box.append(p)
  }
  for (const action of actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ghost'
    button.textContent = action.label
    button.dataset.action = action.id
    button.addEventListener('click', action.run, { once: true })
    box.append(button)
  }
  state.lastOutcome = { kind, lines, at: Date.now() }
}

const ERROR_TEXT = {
  conflict: '다른 39page 탭이 먼저 바꿨어요. 최신 목록으로 다시 해 주세요.',
  busy: '다른 39page 탭이 저장하는 중이에요. 잠시 뒤 다시 해 주세요.',
  'not-found': '고른 플레이리스트가 없어졌어요. 목록을 다시 불러왔어요.',
  'not-persisted': '39page 저장소에 쓰지 못했어요 (용량 등). 저장되지 않았어요.',
  'not-verified': '저장했다는 응답을 받았지만 다시 읽어 확인하지 못했어요. 39page 에서 확인해 주세요.',
  expired: '요청이 너무 늦게 도착해 저장을 시작하지 않았어요. 다시 해 주세요.',
  'empty-name': '새 목록 이름을 입력해 주세요.',
}

function blockedText(detail) {
  const which = detail?.store === 'moments' ? 'Moments' : '라이브러리'
  return detail?.status === 'unavailable'
    ? `이 브라우저에서 39page 저장소를 쓸 수 없어요. ${which} 은(는) 저장하지 않았어요.`
    : `39page ${which} 데이터가 보호 상태예요 (손상 · 새 버전). 덮어쓰지 않으려고 저장하지 않았어요. 39page 에서 확인해 주세요.`
}

/* ------------------------------ 불러오기 ------------------------------ */

async function loadVideo() {
  const v = await send({ type: 'video/read' }).catch(() => null)
  if (v?.ok !== true) {
    state.video = null
    $('#video-title').textContent = 'YouTube 영상을 찾지 못했어요'
    $('#video-meta').textContent = '영상 페이지에서 다시 열어 주세요.'
    return
  }
  state.video = v
  $('#video-title').textContent = v.title ?? '제목을 읽지 못했습니다'
  $('#video-meta').textContent = `${v.videoId}${v.atSeconds === null ? '' : ` · ${formatTime(v.atSeconds)}`}`
}

async function loadLists() {
  // 다시 그리기 전에 사용자가 고른 목록을 기억한다 — 저장 뒤 목록을 새로 받아도 선택이 튀지 않게.
  const previous = document.querySelector('#lists input[name=target]:checked')?.value
  const res = await call({ op: 'library/list', videoId: state.video?.videoId ?? null })
  const box = $('#lists')
  box.replaceChildren()
  if (res.kind !== 'response' || !res.response.ok) {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = '39page 에 연결하지 못했어요. 아래 "수집 화면으로 열기" 를 쓸 수 있어요.'
    box.append(p)
    state.lists = []
    $('#result').dataset.connection = 'unavailable'
    return false
  }
  $('#result').dataset.connection = 'ok'
  const { playlists, selectedPlaylistId } = res.response.data
  state.lists = playlists
  for (const list of playlists) {
    const label = document.createElement('label')
    label.className = 'row'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'target'
    input.value = list.id
    input.checked = previous === undefined ? list.id === selectedPlaylistId : previous === list.id
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = list.name
    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = `${list.trackCount}곡`
    label.append(input, name, meta)
    if (list.positions.length > 0) {
      const dup = document.createElement('span')
      dup.className = 'dup'
      dup.textContent = `이미 ${list.positions.join(', ')}번째`
      label.append(dup)
    }
    box.append(label)
  }
  updateButtons()
  return true
}

async function loadVideoMoments() {
  if (state.video === null) return
  const res = await call({ op: 'moment/list-for-video', videoId: state.video.videoId })
  if (res.kind === 'response' && res.response.ok) {
    const count = res.response.data.moments.length
    $('#video-moments').textContent =
      count === 0 ? '이 영상의 Moment 가 아직 없어요.' : `이 영상의 Moment ${count}개`
  }
}

function freeze() {
  state.frozenAt = state.video?.atSeconds ?? null
  $('#frozen-time').textContent = formatTime(state.frozenAt)
  updateButtons()
}

function selectedTarget() {
  return document.querySelector('input[name=target]:checked')?.value ?? null
}

function updateButtons() {
  const target = selectedTarget()
  $('#new-name').disabled = target !== '__new__'
  const hasName = $('#new-name').value.trim() !== ''
  $('#add-track').disabled =
    state.busy || state.video === null || target === null || (target === '__new__' && !hasName)
  $('#save-moment').disabled = state.busy || state.video === null || state.frozenAt === null
  $('#add-track').textContent = state.busy ? '저장 중…' : '플레이리스트에 담기'
  $('#save-moment').textContent = state.busy ? '저장 중…' : 'Moment 저장'
}

function setBusy(value) {
  state.busy = value
  for (const id of ['#pane-track', '#pane-moment']) $(id).setAttribute('aria-busy', String(value))
  updateButtons()
}

/* ------------------------------ 음악 담기 ------------------------------ */

async function addTo(playlistId, playlistName) {
  const before = state.lists.find((l) => l.id === playlistId)?.positions.length ?? 0
  const payload = {
    op: 'track/add',
    playlistId,
    videoId: state.video.videoId,
    title: state.video.title,
  }
  const res = await call(payload)
  await settleTrack(res, { playlistId, playlistName, before })
}

async function createAndAdd(name) {
  const sameNameBefore = state.lists.filter((l) => l.name === name).map((l) => l.id)
  const res = await call({
    op: 'playlist/create-and-add',
    name,
    videoId: state.video.videoId,
    title: state.video.title,
  })
  await settleTrack(res, { playlistId: null, playlistName: name, before: 0, sameNameBefore })
}

async function settleTrack(res, ctx) {
  if (res.kind === 'response' && res.response.ok) {
    const d = res.response.data
    showResult('saved', [
      `‘${d.playlistName}’ ${d.position}번째에 담았어요.`,
      d.created ? '새 플레이리스트를 만들었어요. 39page 에서 바로 보입니다.' : '39page 에서 바로 보입니다.',
    ])
    $('#new-name').value = ''
    await loadLists()
    return
  }
  if (res.kind === 'response') {
    const { code, detail } = res.response.error
    if (code === 'partial') {
      // 목록은 저장됐다. 같은 "만들고 담기" 를 다시 하면 목록이 하나 더 생기므로 그 목록에 담는다.
      await loadLists()
      showResult(
        'partial',
        [
          `‘${detail.playlistName}’ 목록은 만들었지만 곡은 담지 못했어요.`,
          ERROR_TEXT[detail.cause] ?? `이유: ${detail.cause}`,
        ],
        [
          {
            id: 'retry-partial',
            label: `‘${detail.playlistName}’에 다시 담기`,
            run: () => withBusy(() => addTo(detail.playlistId, detail.playlistName)),
          },
        ],
      )
      return
    }
    if (code === 'blocked') {
      showResult('blocked', [blockedText(detail)], [fallbackAction('track')])
      return
    }
    await loadLists()
    showResult('failed', [ERROR_TEXT[code] ?? `저장하지 못했어요 (${code}).`], retryActions(ctx))
    return
  }
  // 전송 실패 — 저장됐는지 모른다. 다시 보내기 전에 먼저 확인한다.
  showResult('unknown', ['저장됐는지 확인하는 중…'])
  await reconcileTrack(ctx)
}

function retryActions(ctx) {
  return [
    {
      id: 'retry',
      label: '다시 시도',
      run: () =>
        withBusy(() =>
          ctx.playlistId === null ? createAndAdd(ctx.playlistName) : addTo(ctx.playlistId, ctx.playlistName),
        ),
    },
  ]
}

async function reconcileTrack(ctx) {
  const ok = await loadLists()
  if (!ok) {
    showResult(
      'unknown',
      ['39page 와 연결이 끊겨 저장됐는지 확인하지 못했어요.', '39page 에서 목록을 확인하거나 수집 화면으로 열어 주세요.'],
      [fallbackAction('track')],
    )
    return
  }
  let target = ctx.playlistId === null ? null : state.lists.find((l) => l.id === ctx.playlistId)
  if (ctx.playlistId === null) {
    target = state.lists.find((l) => l.name === ctx.playlistName && !ctx.sameNameBefore.includes(l.id)) ?? null
  }
  const after = target?.positions.length ?? 0
  if (target !== null && target !== undefined && after > ctx.before) {
    showResult('saved', [
      `응답은 끊겼지만 ‘${target.name}’ ${target.positions.at(-1)}번째에 저장된 것을 확인했어요.`,
    ])
    return
  }
  if (ctx.playlistId === null && target !== null && target !== undefined) {
    // 목록만 생겼다 — 부분 성공과 같다.
    showResult('partial', [`‘${target.name}’ 목록은 만들어졌지만 곡은 없어요.`], [
      {
        id: 'retry-partial',
        label: `‘${target.name}’에 다시 담기`,
        run: () => withBusy(() => addTo(target.id, target.name)),
      },
    ])
    return
  }
  showResult('retry', ['저장되지 않은 것을 확인했어요.'], retryActions(ctx))
}

/* ------------------------------ Moment ------------------------------ */

async function saveMoment(note, atSeconds) {
  const startedAt = new Date(Date.now() - 2_000).toISOString()
  const payload = {
    op: 'moment/add',
    videoId: state.video.videoId,
    atSeconds,
    note,
    title: state.video.title,
  }
  const res = await call(payload)
  if (res.kind === 'response' && res.response.ok) {
    showResult('saved', [`${formatTime(atSeconds)} Moment 를 저장했어요.`, '39page Moments 에서 바로 보입니다.'], [
      {
        id: 'also-add',
        label: '이 곡을 플레이리스트에도 담기',
        run: () => selectTab('track'),
      },
    ])
    $('#note').value = ''
    await loadVideoMoments()
    return
  }
  if (res.kind === 'response') {
    const { code, detail } = res.response.error
    if (code === 'blocked') {
      showResult('blocked', [blockedText(detail)], [fallbackAction('moment')])
      return
    }
    // 메모를 지우지 않는다 — 다시 누르면 같은 메모로 저장된다.
    showResult('failed', [ERROR_TEXT[code] ?? `저장하지 못했어요 (${code}).`], [
      { id: 'retry', label: '다시 시도', run: () => withBusy(() => saveMoment(note, atSeconds)) },
    ])
    return
  }
  showResult('unknown', ['저장됐는지 확인하는 중…'])
  const check = await call({ op: 'moment/find', videoId: state.video.videoId, atSeconds, since: startedAt })
  if (check.kind !== 'response' || !check.response.ok) {
    showResult(
      'unknown',
      ['39page 와 연결이 끊겨 저장됐는지 확인하지 못했어요.', '메모는 그대로 두었어요.'],
      [fallbackAction('moment')],
    )
    return
  }
  const match = check.response.data.matches.find((m) => m.note === note)
  if (match !== undefined) {
    showResult('saved', [`응답은 끊겼지만 ${formatTime(atSeconds)} Moment 가 저장된 것을 확인했어요.`])
    $('#note').value = ''
    return
  }
  showResult('retry', ['저장되지 않은 것을 확인했어요. 메모는 그대로 두었어요.'], [
    { id: 'retry', label: '다시 시도', run: () => withBusy(() => saveMoment(note, atSeconds)) },
  ])
}

/* ------------------------------ 공통 ------------------------------ */

function fallbackAction(kind) {
  return { id: 'fallback', label: '39page 수집 화면으로 열기', run: () => openFallback(kind) }
}

function openFallback(kind) {
  if (state.video === null) return
  void send({
    type: 'collect/fallback',
    kind,
    videoId: state.video.videoId,
    atSeconds: kind === 'moment' ? state.frozenAt : undefined,
  })
}

async function withBusy(run) {
  if (state.busy) return // 연속 클릭 — 하나만
  setBusy(true)
  try {
    await run()
  } finally {
    setBusy(false)
  }
}

function selectTab(which) {
  const track = which === 'track'
  $('#tab-track').setAttribute('aria-selected', String(track))
  $('#tab-moment').setAttribute('aria-selected', String(!track))
  $('#pane-track').hidden = !track
  $('#pane-moment').hidden = track
  if (!track) {
    void loadVideo().then(() => {
      freeze()
      void loadVideoMoments()
    })
  }
}

/* ------------------------------ 연결 ------------------------------ */

$('#close').addEventListener('click', () => {
  // 부모(YouTube 페이지의 content script 자리)에게만 — 그쪽이 origin 과 창을 확인한다.
  globalThis.parent.postMessage({ ns: '39page-poc-float', type: 'close' }, '*')
})
$('#tab-track').addEventListener('click', () => selectTab('track'))
$('#tab-moment').addEventListener('click', () => selectTab('moment'))
$('#lists').addEventListener('change', updateButtons)
$('#target-new').addEventListener('change', () => {
  updateButtons()
  $('#new-name').focus()
})
$('#new-name').addEventListener('input', updateButtons)
$('#refreeze').addEventListener('click', () => void loadVideo().then(freeze))
$('#add-track').addEventListener('click', () =>
  withBusy(async () => {
    const target = selectedTarget()
    if (target === '__new__') return createAndAdd($('#new-name').value.trim())
    const list = state.lists.find((l) => l.id === target)
    if (list !== undefined) return addTo(list.id, list.name)
  }),
)
$('#save-moment').addEventListener('click', () =>
  withBusy(() => saveMoment($('#note').value, state.frozenAt)),
)
$('#fallback').addEventListener('click', () =>
  openFallback($('#pane-moment').hidden ? 'track' : 'moment'),
)
$('#route').addEventListener('change', (event) => {
  state.route = event.target.value
  void loadLists()
})

// 파티션 측정용 (하네스 전용 주소 매개변수) — 패널 안에 39page 문서를 겹쳐 넣어 본다.
if (params.has('probe') || params.has('nest-bridge')) {
  const nested = document.createElement('iframe')
  nested.src = params.has('probe')
    ? 'http://127.0.0.1:4173/poc/m11-bridge/web/probe.html'
    : 'http://127.0.0.1:4173/poc/m11-bridge/web/bridge.html'
  nested.id = 'nested'
  $('#probe-slot').append(nested)
  globalThis.addEventListener('message', (event) => {
    if (event.source === nested.contentWindow && event.data?.kind === 'loaded') {
      state.nestedProbe = event.data.report
    }
  })
}
if (params.get('route') === 'tab-port') {
  state.route = 'tab-port'
  $('#route').value = 'tab-port'
}

void (async () => {
  await loadVideo()
  freeze()
  await loadLists()
})()
