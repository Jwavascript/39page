/**
 * M11-7B — NOW PLAYLIST 위젯 (PLAYLISTS 카드 위젯을 대신한다, ADR 0030).
 *
 * 앱 전체를 올려 실제 조립(라이브러리 · 코디네이터 · 보관함)으로 본다. 플레이어는 `FakePlayerAdapter`.
 *
 *   재생 큐가 있으면 큐, 없으면 고른 목록을 "재생 대기" 로 — 섞지 않는다
 *   출처를 모르면 목록 이름을 지어내지 않는다
 *   재생 중에 "목록 바꾸기" 로 고르면 그 목록을 바로 처음부터 재생한다 (ADR 0038)
 *   줄을 누르면 그 곡 — 같은 영상이 여러 번 있어도 누른 그 줄
 *   출처 목록이 바뀌면 큐가 바로 따라간다 — 안내 상자 없이 (ADR 0038)
 *   관리(이름 · 삭제 · 정렬)는 위젯에 없다
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from '@/app/App.vue'
import { FakePlayerAdapter } from '@/features/playback/FakePlayerAdapter'
import { PLAYER_ADAPTER_FACTORY } from '@/features/playback/PlayerAdapter'
import { STORAGE_KEYS } from '@/shared/storage'
import type { Playlist } from '@/shared/types'
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

import {
  HIDDEN_RECT,
  VISIBLE_RECT,
  installPlayerRect,
  setPlayerRect,
  uninstallPlayerRect,
} from '../support/playerLayout'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'

const track = (id: string, videoId: string, title: string) => ({
  id,
  source: 'youtube' as const,
  videoId,
  title,
})

const DEFAULT_LISTS: Playlist[] = [
  {
    id: 'one',
    name: 'ONE',
    tracks: [track('t1', A, 'Alpha'), track('t2', B, 'Bravo'), track('t3', A, 'Alpha again')],
  },
  { id: 'two', name: 'TWO', tracks: [track('t4', C, 'Charlie'), track('t5', A, 'Alpha in two')] },
  { id: 'empty', name: 'EMPTY', tracks: [] },
]

function boot(playlists: Playlist[] = DEFAULT_LISTS, selected: string | null = 'one') {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      data: { playlists, selectedPlaylistId: selected },
    }),
  )
  setActivePinia(createPinia())
  const library = useLibraryStore()
  library.restore()
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, library, playback: usePlaybackStore() }
}

type Session = ReturnType<typeof boot>

const widget = (s: Session) => s.wrapper.get('.now-playlist')
const rowTitles = (s: Session) =>
  widget(s)
    .findAll('.track-row .track-title')
    .map((node) => node.text())

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

async function clickRow(s: Session, index: number): Promise<void> {
  await widget(s).findAll('.track-row')[index]?.trigger('click')
  await settle()
}

async function startPlaying(s: Session, index = 0): Promise<void> {
  await clickRow(s, index)
  s.fake.emitReady()
  s.fake.emitStateChange('playing')
  await settle()
}

beforeEach(() => {
  globalThis.localStorage.clear()
  // jsdom 은 레이아웃이 없다 — 영상이 보인다고 세워 두지 않으면 가시성 가드가 모든 재생을 거절한다.
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  globalThis.localStorage.clear()
  document.body.innerHTML = ''
})

describe('A. 큐가 없을 때 — 고른 목록을 "재생 대기" 로', () => {
  it('카세트 레이블은 대기 목록 → 실제 큐 출처를 따르고 출처 불명은 기본 문구다', async () => {
    const s = boot()
    const label = () => s.wrapper.get('.cassette-label div')
    expect(label().text()).toBe('ONE')
    await startPlaying(s)
    await s.library.selectPlaylist('two')
    await settle()
    expect(label().text()).toBe('ONE')
    const long = '긴 한글 제목 日本語 プレイリスト English playlist '.repeat(2).slice(0, 60)
    await s.library.renamePlaylist('one', long)
    await settle()
    expect(label().attributes('title')).toBe(long.trim())
    expect(s.wrapper.get('.deck-art--kawaii-synth-cassette').attributes('aria-label')).toContain(
      long.trim(),
    )
    s.playback.setQueue([track('external', C, 'Outside')], 0)
    await settle()
    expect(label().text()).toBe('KAWAII SYNTH MIX')
  })
  it('고른 목록의 곡을 보이고, 재생 중이라고 말하지 않는다', () => {
    const s = boot()

    expect(widget(s).attributes('data-view')).toBe('standby')
    expect(widget(s).get('.widget-title').text()).toContain('NOW PLAYLIST')
    expect(widget(s).get('.state-chip').text()).toBe('재생 대기')
    expect(widget(s).get('.list-name').text()).toBe('ONE')
    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again'])
    // 어느 줄도 "지금 곡" 이 아니다.
    expect(widget(s).findAll('.track-row.is-current')).toHaveLength(0)
    expect(widget(s).text()).not.toContain('재생 중')
    expect(s.playback.queue).toEqual([])
  })

  it('곡을 누르면 그 목록이 큐가 되고 그 곡부터 재생한다 — 누른 줄의 트랙 id 로', async () => {
    const s = boot()

    // 셋째 줄은 첫째 줄과 같은 영상(A)이다. 누른 것은 셋째다.
    await startPlaying(s, 2)

    expect(s.playback.queue.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(s.playback.queueIndex).toBe(2)
    expect(s.playback.currentTrack?.id).toBe('t3')
    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(widget(s).get('.state-chip').text()).toBe('재생 중')
    expect(widget(s).get('.track-row.is-current').text()).toContain('Alpha again')
  })

  it('"처음부터 재생" 이 그 목록을 처음부터 재생한다', async () => {
    const s = boot()

    await widget(s).get('.play-all').trigger('click')
    await settle()

    expect(s.playback.queueIndex).toBe(0)
    expect(s.playback.queueSource).toEqual({ playlistId: 'one', name: 'ONE' })
  })

  it('빈 목록은 비어 있다고 말하고 링크 추가로 잇는다 — 누르면 보관함의 링크 입력이 열린다', async () => {
    const s = boot(DEFAULT_LISTS, 'empty')

    expect(widget(s).text()).toContain('이 목록은 비어 있어요')
    expect(widget(s).find('.play-all').exists()).toBe(false)

    await widget(s).get('.add-link').trigger('click')
    await settle()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(s.wrapper.find('form.link-form').exists()).toBe(true)
  })

  it('목록이 하나도 없으면 시작점을 안내한다', async () => {
    const s = boot([], null)

    expect(widget(s).attributes('data-view')).toBe('none')
    expect(widget(s).text()).toContain('아직 플레이리스트가 없어요')
    expect(widget(s).find('.switch-list').exists()).toBe(false)

    await widget(s).get('.widget-foot .pill').trigger('click')
    await settle()
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
  })
})

describe('B. 큐가 있을 때 — 큐를 보인다', () => {
  it('실제 재생 순서 · 위치 · 출처 목록 이름을 보인다', async () => {
    const s = boot()
    await startPlaying(s, 1)

    expect(widget(s).get('.list-name').text()).toBe('ONE')
    expect(widget(s).get('.widget-sub').text()).toContain('2 / 3곡')
    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again'])
  })

  it('다른 줄을 누르면 큐를 다시 뜨지 않고 그 자리로 옮겨 재생한다', async () => {
    const s = boot()
    await startPlaying(s, 0)
    const queueBefore = s.playback.queue

    await clickRow(s, 2)

    expect(s.playback.queue).toBe(queueBefore)
    expect(s.playback.queueIndex).toBe(2)
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({ videoId: A, autoplay: true })
    // 같은 영상의 첫째 줄이 아니라 누른 셋째 줄이 지금 곡이다.
    const current = widget(s)
      .findAll('.track-row')
      .map((row) => row.classes('is-current'))
    expect(current).toEqual([false, false, true])
  })

  it('일시정지하면 "일시정지" 라고 말한다 — 지금 곡 표시는 그대로', async () => {
    const s = boot()
    await startPlaying(s, 0)

    s.fake.emitStateChange('paused')
    await settle()

    expect(widget(s).get('.state-chip').text()).toBe('일시정지')
    expect(widget(s).get('.track-row.is-current').text()).toContain('멈춤')
  })

  it('보관함에서 다른 목록을 골라도 위젯은 큐를 보인다 — 그리고 무엇을 보고 있는지 한 줄로 알린다', async () => {
    const s = boot()
    await startPlaying(s, 0)

    await s.library.selectPlaylist('two')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(widget(s).get('.list-name').text()).toBe('ONE')
    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again'])
    expect(widget(s).get('.widget-sub').text()).toContain('보관함에서 보는 목록: TWO')
    expect(s.playback.currentTrack?.id).toBe('t1')
  })

  it('출처를 모르는 큐(목록 밖 영상)는 목록 이름을 지어내지 않는다', async () => {
    const s = boot()
    s.playback.setQueue([track('moment:zzzzzzzzzzz', 'zzzzzzzzzzz', '밖의 영상')], 0)
    await settle()

    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(widget(s).get('.list-name').text()).toBe('현재 재생 큐')
    expect(widget(s).get('.list-name').text()).not.toBe('ONE')
  })
})

describe('C. 목록 바꾸기 — 재생 중이면 고른 목록을 바로 재생한다 (ADR 0038)', () => {
  it('위젯 안에서 펼치고, 재생 중인 목록과 고른 목록을 글로 구분한다', async () => {
    const s = boot()
    await startPlaying(s, 0)

    const toggle = widget(s).get('.switch-list')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(widget(s).get('.picker-hint').text()).toBe('고른 목록을 처음부터 바로 재생해요.')
    const rows = widget(s).findAll('.picker-row')
    expect(rows.map((row) => row.get('.picker-name').text())).toEqual(['ONE', 'TWO', 'EMPTY'])
    expect(rows[0]?.text()).toContain('재생 중인 목록')
    expect(rows[0]?.attributes('aria-current')).toBe('true')
    expect(rows[2]?.text()).toContain('비어 있음')
    // 떠 있는 팝오버가 아니다 — 위젯 안의 요소다 (영상을 덮지 않는다).
    expect(widget(s).find('#now-playlist-picker').exists()).toBe(true)
  })

  it('재생 중에 다른 목록을 고르면 안내 없이 그 목록을 처음부터 바로 재생한다', async () => {
    const s = boot()
    await startPlaying(s, 1)

    await widget(s).get('.switch-list').trigger('click')
    await widget(s).findAll('.picker-row')[1]?.trigger('click')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(widget(s).get('.list-name').text()).toBe('TWO')
    expect(rowTitles(s)).toEqual(['Charlie', 'Alpha in two'])
    expect(s.playback.queueSource).toEqual({ playlistId: 'two', name: 'TWO' })
    expect(s.playback.currentTrack?.id).toBe('t4')
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({ videoId: C, autoplay: true })
    // 안내 상자가 없고, 펼친 목록은 닫힌다.
    expect(widget(s).find('.source-notice').exists()).toBe(false)
    expect(widget(s).find('#now-playlist-picker').exists()).toBe(false)
    // 고른 목록은 저장된다 (기존 selectPlaylist).
    expect(s.library.selectedPlaylistId).toBe('two')
  })

  it('빈 목록을 고르면 재생은 그대로이고, 그 목록을 "재생 대기" 로 보이며 지금 재생을 부제에 적는다', async () => {
    const s = boot()
    await startPlaying(s, 1)
    const loads = s.fake.calls.load.length

    await widget(s).get('.switch-list').trigger('click')
    await widget(s).findAll('.picker-row')[2]?.trigger('click')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('standby')
    expect(widget(s).get('.list-name').text()).toBe('EMPTY')
    expect(widget(s).text()).toContain('이 목록은 비어 있어요')
    expect(widget(s).get('.widget-sub').text()).toContain('지금 재생: ONE')
    expect(widget(s).find('.source-notice').exists()).toBe(false)
    expect(s.playback.queueSource?.playlistId).toBe('one')
    expect(s.playback.currentTrack?.id).toBe('t2')
    expect(s.fake.calls.load).toHaveLength(loads)
  })

  it('영상이 가려져 재생하지 못하면 고른 목록을 "재생 대기" 로 보이고 이유를 말한다 — 곡을 누르면 다시 시도', async () => {
    const s = boot()
    await startPlaying(s, 0)
    const loads = s.fake.calls.load.length
    setPlayerRect(HIDDEN_RECT)

    await widget(s).get('.switch-list').trigger('click')
    await widget(s).findAll('.picker-row')[1]?.trigger('click')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('standby')
    expect(widget(s).get('.list-name').text()).toBe('TWO')
    expect(widget(s).get('.widget-notice').text()).toContain('영상이 가려져')
    expect(s.playback.queueSource?.playlistId).toBe('one')
    expect(s.fake.calls.load).toHaveLength(loads)

    setPlayerRect(VISIBLE_RECT)
    await clickRow(s, 1)

    expect(s.playback.queueSource).toEqual({ playlistId: 'two', name: 'TWO' })
    expect(s.playback.currentTrack?.id).toBe('t5')
    expect(widget(s).attributes('data-view')).toBe('queue')
  })

  it('재생 중인 목록을 다시 고르면 큐 보기다 — 처음부터 다시 틀지 않는다', async () => {
    const s = boot()
    await startPlaying(s, 1)
    const loads = s.fake.calls.load.length
    await s.library.selectPlaylist('two')
    await widget(s).get('.switch-list').trigger('click')
    await widget(s).findAll('.picker-row')[0]?.trigger('click')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(s.library.selectedPlaylistId).toBe('one')
    expect(s.playback.currentTrack?.id).toBe('t2')
    expect(s.fake.calls.load).toHaveLength(loads)
  })

  it('재생 큐가 없으면 고른 목록을 "재생 대기" 로 보일 뿐 재생하지 않는다', async () => {
    const s = boot()

    await widget(s).get('.switch-list').trigger('click')
    expect(widget(s).get('.picker-hint').text()).toBe('볼 목록을 고르세요.')
    await widget(s).findAll('.picker-row')[1]?.trigger('click')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('standby')
    expect(widget(s).get('.list-name').text()).toBe('TWO')
    expect(s.playback.queue).toEqual([])
    expect(s.fake.calls.load).toHaveLength(0)
  })
})

describe('D. 큐는 출처 목록을 따른다 — 안내 없이, 지금 곡은 끊기지 않게 (ADR 0038)', () => {
  it('순서를 바꾸면 줄 순서와 지금 곡 표시가 바로 바뀌고, 안내도 플레이어 명령도 없다', async () => {
    const s = boot()
    await startPlaying(s, 1)
    const calls = JSON.stringify(s.fake.calls)

    // 기존 기능으로 순서를 바꾼다: Bravo 를 맨 위로.
    await s.library.moveTrack('one', 't2', 'up')
    await settle()

    expect(rowTitles(s)).toEqual(['Bravo', 'Alpha', 'Alpha again'])
    expect(s.playback.currentTrack?.id).toBe('t2')
    expect(widget(s).get('.track-row.is-current').text()).toContain('Bravo')
    expect(widget(s).get('.widget-sub').text()).toContain('1 / 3곡')
    expect(widget(s).find('.source-notice').exists()).toBe(false)
    // 플레이어에는 아무 명령도 가지 않았다 — 소리 · 재생 위치가 끊기지 않는다.
    expect(JSON.stringify(s.fake.calls)).toBe(calls)
    expect(s.playback.playerState).toBe('playing')
  })

  it('보관함의 끌어 놓기 · 맨 위/아래(moveTrackTo)도 같다 (M11-7C)', async () => {
    const s = boot()
    await startPlaying(s, 0)
    s.fake.emitPosition(37)
    await settle()
    const calls = JSON.stringify(s.fake.calls)

    // Alpha(t1) 를 맨 아래로 — 트랙 id 로 옮긴다(같은 영상 A 가 둘이다).
    expect(await s.library.moveTrackTo('one', 't1', 2)).toMatchObject({ ok: true })
    await settle()

    expect(s.playback.queue.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect(s.playback.currentTrack?.id).toBe('t1')
    expect(s.playback.queueIndex).toBe(2)
    // 플레이어에 명령이 가지 않는다 — 재생 위치가 처음으로 돌아가지 않는다.
    expect(JSON.stringify(s.fake.calls)).toBe(calls)
    expect(s.playback.playerState).toBe('playing')
    expect(widget(s).find('.source-notice').exists()).toBe(false)
  })

  it('곡을 추가하면 바로 큐 끝에 붙는다 — 확장 저장 · 다른 탭의 변경도 같은 길이다', async () => {
    const s = boot()
    await startPlaying(s, 0)

    await s.library.addTrack('one', { videoId: C, title: 'Charlie in one' })
    await settle()

    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again', 'Charlie in one'])
    expect(widget(s).get('.widget-sub').text()).toContain('1 / 4곡')
    expect(widget(s).find('.source-notice').exists()).toBe(false)
    expect(s.playback.currentTrack?.id).toBe('t1')
  })

  it('지금 곡을 지우면 안내 없이 다음 곡으로 넘어가 재생한다', async () => {
    const s = boot()
    await startPlaying(s, 0)

    await s.library.removeTrack('one', 't1')
    await settle()

    expect(rowTitles(s)).toEqual(['Bravo', 'Alpha again'])
    expect(widget(s).get('.track-row.is-current').text()).toContain('Bravo')
    expect(widget(s).find('.source-notice').exists()).toBe(false)
    expect(s.fake.calls.load[s.fake.calls.load.length - 1]).toEqual({ videoId: B, autoplay: true })
  })

  it('출처 목록이 지워지면 그렇다고 말하고 큐는 남는다', async () => {
    const s = boot()
    await startPlaying(s, 0)

    await s.library.deletePlaylist('one')
    await settle()

    expect(widget(s).attributes('data-view')).toBe('queue')
    expect(widget(s).get('.list-name').text()).toBe('ONE')
    expect(widget(s).get('.source-notice').text()).toContain('지워졌어요')
    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again'])
  })

  it('셔플 · 반복을 켜면 부제에 적는다 — 줄 번호가 재생 순서라는 것을 함께 알린다', async () => {
    const s = boot()
    await startPlaying(s, 0)
    const modeButtons = () => s.wrapper.findAll('.now-playing-card button.mode')

    await modeButtons()[0]?.trigger('click')
    await modeButtons()[1]?.trigger('click')
    await settle()

    expect(widget(s).get('.widget-sub').text()).toContain('셔플 · 전체 반복')
    expect(modeButtons()[0]?.attributes('aria-pressed')).toBe('true')
    expect(modeButtons()[1]?.attributes('aria-label')).toBe('반복: 전체 반복 (누르면 한 곡 반복)')
    // 지금 곡이 맨 앞으로 온다.
    expect(widget(s).get('.track-row.is-current').text()).toContain('01')
    expect(s.playback.currentTrack?.id).toBe('t1')

    await modeButtons()[1]?.trigger('click')
    await modeButtons()[1]?.trigger('click')
    await modeButtons()[0]?.trigger('click')
    await settle()
    expect(widget(s).get('.widget-sub').text()).not.toContain('셔플')
    expect(rowTitles(s)).toEqual(['Alpha', 'Bravo', 'Alpha again'])
  })
})

describe('E. 보관함으로 — 편집은 보관함의 일', () => {
  it('"보관함에서 편집" 은 큐의 출처 목록을 골라 음악 탭을 연다', async () => {
    const s = boot()
    await startPlaying(s, 0)
    await s.library.selectPlaylist('two')
    await settle()

    await widget(s).get('.open-archive').trigger('click')
    await settle()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(s.wrapper.get('#archive-tab-music').attributes('aria-selected')).toBe('true')
    expect(s.library.selectedPlaylistId).toBe('one')
    expect(s.wrapper.get('#playlist-editor-title').text()).toBe('ONE')
    // 재생은 그대로다.
    expect(s.playback.currentTrack?.id).toBe('t1')
  })

  it('위젯에는 관리 기능이 없다 — 이름 바꾸기 · 삭제 · 정렬 · 새 목록', () => {
    const s = boot()
    const labels = widget(s)
      .findAll('button')
      .map((button) => `${button.text()} ${button.attributes('aria-label') ?? ''}`)
      .join(' | ')

    for (const word of ['이름 수정', '이름 바꾸기', '삭제', '위로', '아래로', '새 목록']) {
      expect(labels).not.toContain(word)
    }
  })

  it('위젯은 playback store 를 보지 않고, 새 저장 키를 만들지 않는다', async () => {
    const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
    for (const file of [
      'src/features/library/NowPlaylistWidget.vue',
      'src/features/library/useNowPlaylist.ts',
    ]) {
      const code = read(file)
      expect({ file, store: code.includes('usePlaybackStore') }).toEqual({ file, store: false })
      expect({ file, storage: /localStorage|defineStorage/.test(code) }).toEqual({
        file,
        storage: false,
      })
    }

    const s = boot()
    await startPlaying(s, 0)
    await widget(s).get('.switch-list').trigger('click')
    await widget(s).findAll('.picker-row')[1]?.trigger('click')
    await settle()
    const keys = Object.keys(globalThis.localStorage).filter((key) => key.startsWith('39page'))
    // 라이브러리 키(고른 목록) 말고는 생기지 않았다 — 큐 · 출처 · 보기 상태는 메모리에만 있다.
    expect(keys.filter((key) => !key.startsWith('39page.library'))).toEqual([])
  })
})

describe('F. 긴 목록 · 긴 제목 · 좁은 화면', () => {
  const many: Playlist[] = [
    {
      id: 'long',
      name: '비 오는 날 — 창가에서 듣는 아주 긴 이름의 플레이리스트',
      tracks: Array.from({ length: 30 }, (_, index) =>
        track(
          `m${String(index)}`,
          index % 2 === 0 ? A : B,
          index === 3
            ? '아주 긴 제목이 두 줄로 넘어가는지 확인하기 위한 라이브 버전 · Remastered 2026 · Official Video'
            : `Track ${String(index + 1)}`,
        ),
      ),
    },
  ]

  it('30곡이 모두 줄로 있고, 접힌 창은 지금 곡 주변 5줄이다', async () => {
    const s = boot(many, 'long')
    await startPlaying(s, 12)

    const items = widget(s).findAll('.track-item')
    expect(items).toHaveLength(30)
    const inWindow = items
      .map((item, index) => (item.classes('is-outside') ? -1 : index))
      .filter((index) => index !== -1)
    // 지금 곡(13번째, index 12)이 둘째 줄에 오는 창.
    expect(inWindow).toEqual([11, 12, 13, 14, 15])
    expect(widget(s).get('.expand').text()).toContain('전체 30곡 펼치기')
  })

  it('펼치기는 상태를 글과 aria-expanded 로 알린다', async () => {
    const s = boot(many, 'long')
    const expand = widget(s).get('.expand')
    expect(expand.attributes('aria-expanded')).toBe('false')

    await expand.trigger('click')

    expect(expand.attributes('aria-expanded')).toBe('true')
    expect(expand.text()).toContain('접기')
    expect(widget(s).get('.track-rows').classes()).toContain('is-expanded')
  })

  it('긴 제목은 줄 안에서 두 줄까지만 쓰고 전체는 title 에 있다', () => {
    const s = boot(many, 'long')
    const row = widget(s).findAll('.track-row')[3]
    expect(row?.attributes('title')).toContain('Remastered 2026')

    const style = readFileSync(
      resolve(process.cwd(), 'src/features/library/NowPlaylistWidget.vue'),
      'utf8',
    )
    expect(style).toMatch(/\.track-title \{[\s\S]*?-webkit-line-clamp: 2/)
    expect(style).toMatch(/\.list-name \{[\s\S]*?-webkit-line-clamp: 2/)
    expect(style).toMatch(/\.track-title \{[\s\S]*?overflow-wrap: anywhere/)
  })

  it('넓은 화면은 위젯 안에서만 스크롤하고, 한 열(700px 이하)에서는 안쪽 스크롤을 쓰지 않는다', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/library/NowPlaylistWidget.vue'),
      'utf8',
    )
    const style = source.slice(source.indexOf('<style'))
    const [wide, narrow] = style.split('@media (max-width: 700px)')

    expect(wide).toMatch(
      /\.track-rows,\s*\.picker-rows \{[\s\S]*?max-height: var\(--now-playlist-rows-height\)/,
    )
    expect(wide).toMatch(/\.track-rows,\s*\.picker-rows \{[\s\S]*?overflow-y: auto/)
    // 끝까지 스크롤해도 페이지로 넘어가지 않는다.
    expect(wide).toMatch(/\.track-rows,\s*\.picker-rows \{[\s\S]*?overscroll-behavior: contain/)
    expect(narrow).toMatch(/\.track-rows \{[\s\S]*?max-height: none;[\s\S]*?overflow-y: visible/)
    expect(narrow).toMatch(/\.track-item\.is-outside \{\s*display: none/)
    // 페이지를 움직이는 scrollIntoView 를 쓰지 않는다 — 칸 안의 scrollTop 만 바꾼다.
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('scrollIntoView(')
  })
})
