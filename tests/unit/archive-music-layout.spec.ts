/**
 * M11-7B-3 — 보관함 음악 탭의 목록 칸 | 상세 칸 (좁으면 두 단계), 목록 관리의 자리, 작은 영상 띠(배치 C),
 * 모바일 작은 데크 띠 (ADR 0030).
 *
 * jsdom 은 레이아웃 · 컨테이너 쿼리를 계산하지 않는다. 동작(단계 · 포커스 · 저장 · 재생)은 앱을 올려 보고,
 * 배치 규칙은 소스로 고정한다. 실제 배치 · 크기 · 겹침은 실제 Chrome 측정이 확인한다
 * (`docs/product/M11_7_UX_REDESIGN.md` · M11-7B 검증).
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
import { LIBRARY_STORAGE_VERSION, useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'

import {
  installMatchMedia,
  installPlayerRect,
  uninstallMatchMedia,
  uninstallPlayerRect,
} from '../support/playerLayout'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
const styleOf = (path: string): string => {
  const source = read(path)
  return source.slice(source.indexOf('<style'))
}

function seed(): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.library,
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      data: {
        playlists: [
          {
            id: 'one',
            name: 'ONE',
            tracks: [
              { id: 't1', source: 'youtube', videoId: A, title: 'Alpha' },
              { id: 't2', source: 'youtube', videoId: B, title: 'Bravo' },
            ],
          },
          {
            id: 'two',
            name: 'TWO',
            tracks: [{ id: 't3', source: 'youtube', videoId: A, title: 'Alpha in two' }],
          },
        ],
        selectedPlaylistId: 'one',
      },
    }),
  )
}

function boot() {
  seed()
  setActivePinia(createPinia())
  useLibraryStore().restore()
  const fake = new FakePlayerAdapter()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { provide: { [PLAYER_ADAPTER_FACTORY as symbol]: () => fake } },
  })
  return { wrapper, fake, library: useLibraryStore(), playback: usePlaybackStore() }
}

type Session = ReturnType<typeof boot>

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
  await nextTick()
}

async function openArchive(s: Session): Promise<void> {
  await s.wrapper.get('.app-nav button').trigger('click')
  await settle()
}

const step = (s: Session) => s.wrapper.get('.music-layout').attributes('data-step')

beforeEach(() => {
  globalThis.localStorage.clear()
  installPlayerRect()
})

afterEach(() => {
  uninstallPlayerRect()
  uninstallMatchMedia()
  globalThis.localStorage.clear()
  document.documentElement.style.overflow = ''
  document.body.innerHTML = ''
})

describe('A. 목록 칸 | 상세 칸 — 좁으면 두 단계', () => {
  it('두 칸은 늘 마운트되어 있고, 처음 열면 목록 단계다', async () => {
    const s = boot()
    await openArchive(s)

    expect(s.wrapper.find('.music-layout .archive-lists').exists()).toBe(true)
    expect(s.wrapper.find('.music-layout .playlist-editor').exists()).toBe(true)
    expect(step(s)).toBe('lists')
  })

  it('목록을 고르면 상세 단계 — 그 목록의 곡이 곧바로 보인다', async () => {
    const s = boot()
    await openArchive(s)

    await s.wrapper.findAll('.archive-lists .list-select')[1]?.trigger('click')
    await settle()

    expect(step(s)).toBe('detail')
    expect(s.library.selectedPlaylistId).toBe('two')
    expect(s.wrapper.get('#playlist-editor-title').text()).toBe('TWO')
    expect(s.wrapper.get('.playlist-editor').text()).toContain('Alpha in two')
  })

  it('이미 고른 목록을 다시 눌러도 상세 단계로 간다 — 다시 저장하지 않는다', async () => {
    const s = boot()
    await openArchive(s)
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.library)

    await s.wrapper.findAll('.archive-lists .list-select')[0]?.trigger('click')
    await settle()

    expect(step(s)).toBe('detail')
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.library)).toBe(before)
  })

  it('상세 단계에는 "목록으로" 와 위치 표시가 있고, 누르면 목록 단계로 돌아온다', async () => {
    const s = boot()
    await openArchive(s)
    await s.wrapper.findAll('.archive-lists .list-select')[1]?.trigger('click')
    await settle()

    const back = s.wrapper.get('.playlist-editor .back-to-lists')
    expect(back.text()).toContain('목록으로')
    expect(s.wrapper.get('.playlist-editor .crumb').text()).toContain('보관함 › 음악')

    await back.trigger('click')
    await settle()
    expect(step(s)).toBe('lists')
  })

  it('새 목록을 만들면 상세 단계의 링크 입력으로 바로 간다 (U15 유지)', async () => {
    const s = boot()
    await openArchive(s)

    await s.wrapper.get('.archive-lists .pill--strong').trigger('click')
    await settle()
    await s.wrapper.get('#archive-new-playlist-name').setValue('새 목록')
    await s.wrapper.get('.archive-lists form.create-form').trigger('submit')
    await settle()

    expect(step(s)).toBe('detail')
    expect(s.wrapper.get('#playlist-editor-title').text()).toBe('새 목록')
    expect(document.activeElement).toBe(s.wrapper.get('#track-url').element)
  })

  it('NOW PLAYLIST 의 "보관함에서 편집" 은 목록 단계를 건너뛰고 상세로 연다', async () => {
    const s = boot()

    await s.wrapper.get('.now-playlist .open-archive').trigger('click')
    await settle()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(step(s)).toBe('detail')
  })

  it('링크를 추가해도 양식이 남고, 입력란 포커스가 페이지를 움직이지 않는다', async () => {
    const s = boot()
    await openArchive(s)
    await s.wrapper.findAll('.archive-lists .list-select')[0]?.trigger('click')
    await settle()
    const calls: unknown[] = []
    const original = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (this.id === 'track-url') calls.push(options)
      original.call(this, options)
    }
    try {
      await s.wrapper.findAll('.playlist-editor .head-actions .pill')[1]?.trigger('click')
      await settle()
      await s.wrapper.get('#track-url').setValue('https://youtu.be/ccccccccccc')
      await s.wrapper.get('form.link-form').trigger('submit')
      await settle()
    } finally {
      HTMLElement.prototype.focus = original
    }

    expect(s.wrapper.find('form.link-form').exists()).toBe(true)
    expect(document.activeElement).toBe(s.wrapper.get('#track-url').element)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const options of calls) expect(options).toEqual({ preventScroll: true })
  })

  it('상세 칸의 머리말(이름 · 곡 수 · 전체 재생 · 링크 추가)은 스크롤 영역 밖이다', () => {
    const source = read('src/features/library/PlaylistEditor.vue')
    const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>'))
    const head = template.slice(
      template.indexOf('class="editor-head"'),
      template.indexOf('class="editor-body"'),
    )

    expect(head).toContain('id="playlist-editor-title"')
    expect(head).toContain('▶ 목록 전체 재생')
    expect(head).toContain('＋ YouTube 링크 추가')
    const style = styleOf('src/features/library/PlaylistEditor.vue')
    expect(style).toMatch(/\.editor-head \{[^}]*flex: none/)
    expect(style).toMatch(/\.editor-body \{[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/)
  })

  it('음악 탭 본문은 스크롤하지 않고 두 칸이 각자 스크롤한다. 좁은 보관함은 컨테이너 폭으로 두 단계', () => {
    const panel = styleOf('src/features/archive/ArchivePanel.vue')
    expect(panel).toMatch(
      /\.archive-body--music \{[^}]*overflow: hidden[^}]*container: archive-music \/ inline-size/,
    )
    expect(panel).toMatch(
      /\.music-layout \{[^}]*grid-template-columns: minmax\(220px, 0\.8fr\) minmax\(0, 1\.6fr\)/,
    )
    expect(panel).toMatch(/@container archive-music \(max-width: 640px\)/)
    expect(panel).toContain(".music-layout[data-step='lists'] > .music-detail")
    expect(panel).toContain(".music-layout[data-step='detail'] > .music-lists")

    const lists = styleOf('src/features/library/ArchivePlaylistNav.vue')
    expect(lists).toMatch(/\.list-rows \{[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/)
  })
})

describe('B. 목록 관리는 목록 칸에 — 재생은 상세 칸에', () => {
  it('"관리" 를 펴면 이름 수정 · 목록 삭제가 그 행 아래에 있다', async () => {
    const s = boot()
    await openArchive(s)

    const toggle = s.wrapper.findAll('.archive-lists .list-manage')[1]
    expect(toggle?.attributes('aria-label')).toBe('TWO 관리 — 이름 수정 · 삭제')
    expect(toggle?.attributes('aria-expanded')).toBe('false')
    await toggle?.trigger('click')

    const panel = s.wrapper.findAll('.archive-lists .list-row')[1]?.get('.manage-panel')
    expect(panel?.findAll('button').map((b) => b.text())).toEqual(['이름 수정', '목록 삭제'])
    expect(toggle?.attributes('aria-expanded')).toBe('true')
  })

  it('이름 수정은 고른 목록이 아니어도 그 행의 목록을 고친다 — 선택은 그대로', async () => {
    const s = boot()
    await openArchive(s)
    await s.wrapper.findAll('.archive-lists .list-manage')[1]?.trigger('click')
    await s.wrapper
      .findAll('.archive-lists .manage-panel button')
      .find((b) => b.text() === '이름 수정')
      ?.trigger('click')
    await settle()

    const input = s.wrapper.get('#playlist-name')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('TWO 새 이름')
    await s.wrapper.get('.archive-lists form.name-form').trigger('submit')
    await settle()

    expect(s.library.getPlaylist('two')?.name).toBe('TWO 새 이름')
    expect(s.library.selectedPlaylistId).toBe('one')
    expect(s.wrapper.find('.archive-lists .manage-panel').exists()).toBe(false)
  })

  it('삭제는 그 행 아래에서 확인을 받고, 곡 수와 "Moments 는 남아요" 를 말한다', async () => {
    const s = boot()
    await openArchive(s)
    await s.wrapper.findAll('.archive-lists .list-manage')[0]?.trigger('click')
    await s.wrapper
      .findAll('.archive-lists .manage-panel button')
      .find((b) => b.text() === '목록 삭제')
      ?.trigger('click')

    const confirm = s.wrapper.get('.archive-lists [role="alertdialog"]')
    expect(confirm.text()).toContain('“ONE” 과 곡 2개')
    expect(confirm.text()).toContain('Moments 는 남아요')
    expect(s.library.playlists).toHaveLength(2)

    await confirm.get('.pill--strong').trigger('click')
    await settle()
    expect(s.library.playlists.map((p) => p.name)).toEqual(['TWO'])
  })

  it('상세 칸에는 이름 수정 · 삭제가 없다', async () => {
    const s = boot()
    await openArchive(s)
    const labels = s.wrapper
      .get('.playlist-editor')
      .findAll('button')
      .map((b) => b.text())
    expect(labels).not.toContain('이름 수정')
    expect(labels).not.toContain('목록 삭제')
  })

  it('"♪ 재생 중인 목록" 은 큐의 출처 하나에만 붙는다 — 같은 영상이 든 다른 목록에는 붙지 않는다', async () => {
    const s = boot()
    await s.wrapper.findAll('.now-playlist .track-row')[0]?.trigger('click')
    await settle()
    await openArchive(s)

    const rows = s.wrapper.findAll('.archive-lists .list-row')
    expect(rows[0]?.classes()).toContain('is-playing')
    expect(rows[0]?.text()).toContain('♪ 재생 중인 목록')
    // TWO 에도 같은 영상(A)이 있다. 짐작했다면 여기에 붙었을 것이다.
    expect(rows[1]?.classes()).not.toContain('is-playing')
    expect(rows[1]?.text()).not.toContain('재생 중')
  })
})

describe('C. 작은 영상 띠 (배치 C)', () => {
  it('넓은 화면에서 보관함을 열면 띠 배치이고, 플레이어 노드는 그대로다', async () => {
    installMatchMedia(false)
    const s = boot()
    const mountNode = s.wrapper.get('.player-mount').element
    const playerRoot = s.wrapper.get('[data-widget="player"]').element
    const momentsRoot = s.wrapper.get('[data-widget="moments"]').element

    await openArchive(s)

    const workspace = s.wrapper.get('.workspace')
    expect(workspace.attributes('data-archive-layout')).toBe('strip')
    expect(s.wrapper.get('.player-mount').element).toBe(mountNode)
    expect(s.wrapper.get('[data-widget="player"]').element).toBe(playerRoot)
    // 저장 줄은 같은 Moments 위젯 인스턴스다 — 복제하지 않는다.
    expect(s.wrapper.get('[data-widget="moments"]').element).toBe(momentsRoot)
    expect(s.wrapper.findAll('[data-widget="moments"]')).toHaveLength(1)
    expect(s.fake.calls.mount).toBe(1)

    await s.wrapper.get('[aria-label="보관함 닫기"]').trigger('click')
    await settle()
    expect(workspace.attributes('data-archive-layout')).toBeUndefined()
    expect(s.wrapper.get('.player-mount').element).toBe(mountNode)
    expect(s.fake.calls.destroy).toBe(0)
  })

  /* ── 보관함 닫기 자리 (M11-7C UAT) ─────────────────────────────── */

  it('가로 화면(띠)에서는 "보관함 닫기" 가 영상 띠 오른쪽 위에 있고, 탭 줄에는 × 가 없다', async () => {
    installMatchMedia(false)
    const s = boot()
    const button = s.wrapper.get('.strip-close')
    // 닫혀 있으면 숨어 있다 — 노드는 늘 있다(열고 닫을 때 플레이어 앞에 노드를 넣고 빼지 않는다).
    expect(button.attributes('hidden')).toBeDefined()

    await openArchive(s)
    expect(button.attributes('hidden')).toBeUndefined()
    expect(button.text().replace(/\s+/g, ' ')).toBe('보관함 닫기 ×')
    expect(button.attributes('aria-label')).toBe('보관함 닫기')
    expect(button.attributes('aria-controls')).toBe('archive-panel')
    expect(s.wrapper.find('#archive-panel .archive-head .close').exists()).toBe(false)
    // 재생 띠(위젯 호스트) 앞, 보관함 밖 — 영상 · 조작 · Moments 위젯 안에 들어가지 않는다.
    const host = s.wrapper.get('.widget-host').element
    expect(button.element.nextElementSibling).toBe(host)
    expect(s.wrapper.get('[data-widget="moments"]').find('.strip-close').exists()).toBe(false)
  })

  it('띠의 "보관함 닫기" 로 닫으면 플레이어 · 재생은 그대로이고 포커스가 연 단추로 돌아온다', async () => {
    installMatchMedia(false)
    const s = boot()
    await s.wrapper.get('.playlist-play, .now-playlist .track-row').trigger('click')
    await settle()
    s.fake.emitReady()
    s.fake.emitStateChange('playing')
    await settle()
    const mountNode = s.wrapper.get('.player-mount').element
    const opener = s.wrapper.get('.app-nav button').element as HTMLElement
    opener.focus()
    await openArchive(s)
    const calls = JSON.stringify(s.fake.calls)

    await s.wrapper.get('.strip-close').trigger('click')
    await settle()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeDefined()
    expect(s.wrapper.get('.strip-close').attributes('hidden')).toBeDefined()
    expect(s.wrapper.get('.player-mount').element).toBe(mountNode)
    expect(JSON.stringify(s.fake.calls)).toBe(calls)
    expect(s.playback.playerState).toBe('playing')
    expect(document.activeElement).toBe(opener)
  })

  it('Esc 로 닫는 것은 그대로다 (띠 배치)', async () => {
    installMatchMedia(false)
    const s = boot()
    await openArchive(s)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeDefined()
  })

  it('세로(쌓기) · 낮은 가로(옆) 배치는 보관함 머리말의 × 를 그대로 쓴다', async () => {
    installMatchMedia(true)
    const stack = boot()
    await openArchive(stack)
    expect(stack.wrapper.get('.workspace').attributes('data-archive-layout')).toBe('stack')
    expect(stack.wrapper.get('.strip-close').attributes('hidden')).toBeDefined()
    const headClose = stack.wrapper.get('#archive-panel .archive-head .close')
    expect(headClose.attributes('aria-label')).toBe('보관함 닫기')
    await headClose.trigger('click')
    await settle()
    expect(stack.wrapper.get('#archive-panel').attributes('hidden')).toBeDefined()
    stack.wrapper.unmount()
    document.body.innerHTML = ''

    // 낮은 가로 화면 — 옆 배치 질의만 맞는다.
    installMatchMedia(false)
    const plain = window.matchMedia
    window.matchMedia = ((query: string) => ({
      ...plain(query),
      matches: query.includes('max-height: 560px'),
    })) as typeof window.matchMedia
    const side = boot()
    await openArchive(side)
    expect(side.wrapper.get('.workspace').attributes('data-archive-layout')).toBe('side')
    expect(side.wrapper.get('.strip-close').attributes('hidden')).toBeDefined()
    expect(side.wrapper.find('#archive-panel .archive-head .close').exists()).toBe(true)
  })

  it('띠의 닫기는 44px 터치 목표 · 글자 단추 토큰 · 자기 줄(오른쪽 끝)', () => {
    const shell = styleOf('src/components/layout/DashboardShell.vue')
    const block = /\.strip-close \{[^}]*\}/.exec(shell)?.[0] ?? ''
    expect(block).toContain('min-height: 44px')
    expect(block).toContain('min-width: 44px')
    expect(block).toContain('justify-self: end')
    expect(block).toContain('var(--pill-border-color)')
    expect(block).not.toMatch(/position:\s*(absolute|fixed)/)
    expect(shell).toMatch(/\.strip-close\[hidden\] \{\s*display: none;/)
  })

  it('세로 화면에서는 쌓기 배치다', async () => {
    installMatchMedia(true)
    const s = boot()
    await openArchive(s)
    expect(s.wrapper.get('.workspace').attributes('data-archive-layout')).toBe('stack')
  })

  it('보관함이 열린 채로 재생하고, 보관함 Moments › 이 곡에서 같은 저장 명령으로 저장한다', async () => {
    installMatchMedia(false)
    const s = boot()
    await openArchive(s)

    await s.wrapper.get('.playlist-editor .head-actions .pill--strong').trigger('click')
    await settle()
    s.fake.emitReady()
    s.fake.emitStateChange('playing')
    s.fake.emitPosition(42.7)
    await settle()

    expect(s.wrapper.get('#archive-panel').attributes('hidden')).toBeUndefined()
    expect(s.playback.playerState).toBe('playing')
    // M11-7C — 영상 띠는 보기 · 재생 전용이다. 저장은 보관함 Moments › 이 곡에서 한다.
    expect(s.wrapper.find('[data-widget="moments"] .capture-button').exists()).toBe(false)
    await s.wrapper.get('#archive-tab-moments').trigger('click')
    await settle()
    await s.wrapper.get('#archive-panel-moments .capture-button').trigger('click')
    await settle()
    // 잡기만 했다 — Moment 저장을 눌러야 저장된다 (M11-7C 저장 모델 B).
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.moments)).toBeNull()
    await s.wrapper.get('#archive-panel-moments .draft-form').trigger('submit')
    await settle()

    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.moments) as string)
    expect(stored.data).toHaveLength(1)
    expect(stored.data[0]).toMatchObject({ videoId: A, atSeconds: 42 })
  })

  it('띠 · 쌓기 · 옆 배치는 CSS 로만 — 영상 상자를 숨기거나 줄이지 않는다', () => {
    const shell = styleOf('src/components/layout/DashboardShell.vue')
    // 재생 띠(플레이어 · 저장 줄) 외 위젯은 display: none 으로 접는다 (마운트 유지).
    expect(shell).toContain(
      ":deep(.widget-host > :not([data-widget='player'], [data-widget='moments']))",
    )
    expect(shell).toMatch(/grid-template-areas: 'player moments'/)
    expect(read('src/components/layout/DashboardShell.vue')).not.toMatch(/<WidgetHost[^>]*v-if/)

    const player = read('src/features/playback/PlayerSurface.vue')
    const compact = player.slice(player.lastIndexOf('<style>'))
    expect(compact).toContain("[data-archive-layout='strip'] .player-surface")
    // 영상 상자는 자리(grid-area)만 바뀐다.
    for (const rule of [...compact.matchAll(/\.video-holder \{([^}]*)\}/g)].map(
      (m) => m[1] ?? '',
    )) {
      expect(rule.trim()).toBe('grid-area: video;')
    }
    // 플레이어 템플릿에 조건부 렌더가 없다 (ADR 0002).
    const template = player.slice(player.indexOf('<template>'), player.indexOf('</template>'))
    expect(template.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('v-if')
  })

  it('띠 배치의 보관함 높이는 화면 안에서 끝나게 맞추고, 그 상한 · 하한이 있다', () => {
    const shell = read('src/components/layout/DashboardShell.vue')
    expect(shell).toContain('const ARCHIVE_MIN_HEIGHT_PX = 300')
    expect(shell).toContain('const ARCHIVE_MAX_HEIGHT_PX = 900')
    expect(styleOf('src/components/layout/DashboardShell.vue')).toMatch(
      /\.workspace\.is-archive-open > \.archive \{\s*height: var\(--archive-height/,
    )
  })
})

describe('D. 모바일 작은 데크 띠', () => {
  it('700px 이하에서 데크는 띠다 — 아트를 통째로 줄이고, 누를 수 없는 재생 키는 끈다', () => {
    const style = styleOf('src/features/deck/DeckWidget.vue')
    const narrow = style.slice(style.indexOf('@media (max-width: 700px)'))

    expect(narrow).toMatch(/\.deck-widget \{[^}]*grid-template-columns: clamp\(118px, 36%, 164px\)/)
    // 아트 전체가 "보관함 열기" 다.
    expect(narrow).toMatch(
      /\.deck-open--kawaii-synth-cassette \{[^}]*width: 100%;[^}]*height: 100%/,
    )
    expect(narrow).toMatch(/\.deck-key--kawaii-play \{\s*display: none/)
    // 승인된 아트를 자르지 않는다 — 데크 아트 컴포넌트는 그대로이고 clip/viewBox 를 바꾸지 않는다.
    expect(narrow).not.toMatch(/clip-path|object-fit|viewBox/)
  })

  it('한 열 순서는 데크 띠 → 영상 → 이 곡 Moments → NOW PLAYLIST', () => {
    const host = read('src/components/layout/WidgetHost.vue')
    const narrow = host.slice(
      host.indexOf('@media (max-width: 700px)'),
      host.indexOf('@media (max-height: 560px)'),
    )
    expect(narrow).toMatch(/'deck'\s*'player'\s*'moments'\s*'playlist'/)
    expect(narrow).not.toContain('max-width: 420px')
  })

  it('낮은 가로 화면(폰 가로)은 영상이 첫 행이다 — 돌리기만 해도 영상이 화면 밖으로 밀려 멈추지 않게', () => {
    const host = read('src/components/layout/WidgetHost.vue')
    const landscape = host.slice(
      host.indexOf(
        '@media (max-height: 560px) and (orientation: landscape) and (max-width: 1100px)',
      ),
    )
    expect(landscape.length).toBeGreaterThan(0)
    expect(landscape).toMatch(
      /grid-template-areas:\s*'player moments'\s*'player playlist'\s*'deck playlist'/,
    )
    expect(landscape).toContain('minmax(360px, 1fr)')
  })
})
