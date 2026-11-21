<script setup lang="ts">
/**
 * 보관함의 Moment 목록 — 영상별 묶음(접기 · 펼치기) 또는 최근 순 평면 목록 (M9-4 → M11-4).
 *
 * **표현 컴포넌트다.** store 도 코디네이터도 모른다. 무엇을 그릴지(`sections`)는
 * `useMomentsArchive` 가 정하고, 이 컴포넌트는 그리고 누름을 이벤트로 올린다 (`AGENTS.md` 규칙 3).
 *
 * - 묶음 머리는 **접기 단추**다 (`aria-expanded` · `aria-controls`, 제목 수준 4). 접힌 묶음은 줄을
 *   그리지 않는다 — 1,000 · 5,000개에서 DOM 이 데이터 크기를 따라 자라지 않게 (M9-6).
 * - 머리에 그 영상이 든 **목록**을 적고 누르면 음악 탭의 그 목록 · 그 곡으로 간다 (§5-4). 없으면
 *   "목록에 없음" — Moment 는 라이브러리와 독립이라 그대로 남고 재생된다 (ADR 0019).
 * - 줄 하나하나는 `MomentRow` 다. 어느 줄이 메모 수정 · 삭제 확인을 펼쳤는지는 **한 번에 하나**이고
 *   여기서 정한다. 펼침이 사라지면 포커스를 갈 곳으로 옮긴다.
 */
import { nextTick, ref } from 'vue'

import MomentRow, { type MomentRowMode } from './MomentRow.vue'
import type { ArchiveSection } from './useMomentsArchive'
import { highlight } from './momentsSearch'

/** 머리에 이름을 적는 목록 수. 더 있으면 "외 N" 으로 줄인다. */
const MAX_LIST_LINKS = 3

const props = defineProps<{
  sections: readonly ArchiveSection[]
  terms: readonly string[]
  maxNoteLength: number
  saveNote: (momentId: string, note: string) => Promise<boolean>
  /** DOM id 앞머리. */
  idPrefix?: string
  /** 방금 저장한 순간 (M11-7C) — 그 줄을 강조하고, 칸 안에서 보이게 한다. */
  highlightId?: string | null
  /** 줄에 공유 아이콘을 보일지 (ADR 0040 · 0044). 공유는 부모가 연다. */
  canShare?: boolean
}>()

const emit = defineEmits<{
  play: [momentId: string]
  remove: [momentId: string]
  toggle: [videoId: string]
  'more-rows': [videoId: string]
  'open-list': [playlistId: string, videoId: string]
  /** 그 순간을 링크로 공유 (ADR 0040). */
  share: [momentId: string]
  /** 지운 뒤 목록에 포커스를 둘 곳이 없다 — 부모가 정한다(검색란 등). */
  'focus-out': []
}>()

const prefix = (): string => props.idPrefix ?? 'moment'

/** 펼친 줄 하나와 그 펼침의 종류. */
const active = ref<{ id: string; mode: Exclude<MomentRowMode, 'idle'> } | null>(null)

function modeOf(momentId: string): MomentRowMode {
  return active.value?.id === momentId ? active.value.mode : 'idle'
}

/** 목록 루트. `v-for` 안의 `ref` 는 배열이 되므로 루트에서 찾는다 (`TrackList` 와 같은 이유). */
const root = ref<HTMLElement | null>(null)

function focusIn(selector: string): void {
  void nextTick(() => root.value?.querySelector<HTMLElement>(selector)?.focus())
}

function closeEdit(momentId: string): void {
  if (modeOf(momentId) === 'edit') active.value = null
  // 폼이 사라진 자리에 포커스가 떨어지지 않게 그 줄의 연필로 돌려준다.
  focusIn(`[data-moment-edit="${momentId}"]`)
}

/** 취소하면 그 줄의 휴지통으로 포커스 — 누르던 자리로 되돌린다. */
function cancelRemove(momentId: string): void {
  if (modeOf(momentId) === 'confirm') active.value = null
  focusIn(`[data-moment-remove="${momentId}"]`)
}

/**
 * 지운 줄 다음에 포커스를 둘 곳 — 같은 묶음의 다음 줄, 없으면 앞 줄, 묶음이 비면 다음 묶음의
 * 머리(없으면 앞 묶음). 지우기 **전에** 정한다 — 지운 뒤에는 줄이 없다.
 */
function nextFocusAfterRemove(momentId: string): string | null {
  const sections = props.sections
  const sectionIndex = sections.findIndex((s) => s.rows.some((r) => r.moment.id === momentId))
  const section = sections[sectionIndex]
  if (section === undefined) return null
  const rowIndex = section.rows.findIndex((r) => r.moment.id === momentId)
  const neighbour = section.rows[rowIndex + 1] ?? section.rows[rowIndex - 1]
  if (neighbour !== undefined) return `[data-moment-play="${neighbour.moment.id}"]`
  const other = sections[sectionIndex + 1] ?? sections[sectionIndex - 1]
  if (other?.head != null) return `[data-group-toggle="${other.head.videoId}"]`
  return null
}

function confirmRemove(momentId: string): void {
  const target = nextFocusAfterRemove(momentId)
  active.value = null
  emit('remove', momentId)
  // 지운 줄이 사라진 뒤 옮긴다. 갈 곳이 없으면 부모가 검색란 등으로 옮긴다.
  void nextTick(() => {
    void nextTick(() => {
      const el = target === null ? null : root.value?.querySelector<HTMLElement>(target)
      if (el != null) el.focus()
      else emit('focus-out')
    })
  })
}

function metaText(section: ArchiveSection): string {
  const head = section.head
  if (head === null) return ''
  const count =
    head.matched === head.total
      ? `${String(head.total)}개`
      : `${String(head.matched)} / ${String(head.total)}개`
  return count
}
</script>

<template>
  <div ref="root" class="moment-list">
    <!-- :key 는 영상 ID · Moment id 다. 배열 인덱스를 쓰지 않는다. -->
    <template v-for="section in sections" :key="section.key">
      <section
        v-if="section.head !== null"
        class="moment-group"
        :class="{ 'is-current': section.head.isCurrent, 'is-collapsed': !section.head.expanded }"
        :aria-current="section.head.isCurrent ? 'true' : undefined"
        :aria-labelledby="`${prefix()}-group-${section.head.videoId}`"
      >
        <div class="group-head">
          <h4 class="group-heading">
            <button
              type="button"
              class="group-toggle"
              :data-group-toggle="section.head.videoId"
              :aria-expanded="section.head.expanded"
              :aria-controls="`${prefix()}-rows-${section.head.videoId}`"
              @click="emit('toggle', section.head.videoId)"
            >
              <span class="caret" aria-hidden="true">{{ section.head.expanded ? '▾' : '▸' }}</span>
              <span :id="`${prefix()}-group-${section.head.videoId}`" class="group-title"
                ><template v-for="(part, i) in highlight(section.head.title, terms)" :key="i"
                  ><mark v-if="part.match">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ></span
              >
              <!-- 색에만 기대지 않는다. 개수 · 지금 곡 · 목록 여부를 글로 적는다. -->
              <span class="group-meta"
                >{{ metaText(section) }}<template v-if="section.head.isCurrent"> · 재생 중</template
                ><template v-if="section.head.playlists.length === 0">
                  · 목록에 없음</template
                ></span
              >
            </button>
          </h4>
          <p v-if="section.head.playlists.length > 0" class="group-lists">
            <span class="lists-label">목록</span>
            <button
              v-for="list in section.head.playlists.slice(0, MAX_LIST_LINKS)"
              :key="list.id"
              type="button"
              class="list-link"
              :data-open-list="list.id"
              :aria-label="`음악 보관함의 ${list.name} 목록에서 ${section.head.title} 보기`"
              @click="emit('open-list', list.id, section.head.videoId)"
            >
              {{ list.name }}
            </button>
            <span v-if="section.head.playlists.length > MAX_LIST_LINKS" class="lists-more">
              외 {{ section.head.playlists.length - MAX_LIST_LINKS }}
            </span>
          </p>
        </div>

        <ul
          v-if="section.head.expanded"
          :id="`${prefix()}-rows-${section.head.videoId}`"
          class="moment-rows"
        >
          <MomentRow
            v-for="row in section.rows"
            :key="row.moment.id"
            :moment="row.moment"
            :song-title="row.songTitle"
            :terms="terms"
            :mode="modeOf(row.moment.id)"
            :id-prefix="prefix()"
            :max-note-length="maxNoteLength"
            :save-note="saveNote"
            :can-share="canShare === true"
            @play="(id) => emit('play', id)"
            @share="(id) => emit('share', id)"
            @edit="(id) => (active = { id, mode: 'edit' })"
            @request-remove="(id) => (active = { id, mode: 'confirm' })"
            @cancel-remove="cancelRemove"
            @confirm-remove="confirmRemove"
            @close-edit="closeEdit"
          />
        </ul>
        <button
          v-if="section.head.expanded && section.hiddenRows > 0"
          type="button"
          class="pill more-rows"
          @click="emit('more-rows', section.head.videoId)"
        >
          이 곡의 순간 {{ section.hiddenRows }}개 더 보기
        </button>
      </section>

      <!--
        평면 보기 — 묶지 않은 한 목록. 최근 보기는 줄마다 곡 제목을 적고, 이 곡 보기는 적지 않는다(M11-7C —
        듣고 있는 곡이라 되풀이하지 않는다).
      -->
      <ul v-else class="moment-rows moment-rows--flat">
        <MomentRow
          v-for="row in section.rows"
          :key="row.moment.id"
          :moment="row.moment"
          :song-title="row.songTitle"
          :show-song-title="section.showSongTitle !== false"
          :highlighted="row.moment.id === highlightId"
          :terms="terms"
          :mode="modeOf(row.moment.id)"
          :id-prefix="prefix()"
          :max-note-length="maxNoteLength"
          :save-note="saveNote"
          :can-share="canShare === true"
          @play="(id) => emit('play', id)"
          @share="(id) => emit('share', id)"
          @edit="(id) => (active = { id, mode: 'edit' })"
          @request-remove="(id) => (active = { id, mode: 'confirm' })"
          @cancel-remove="cancelRemove"
          @confirm-remove="confirmRemove"
          @close-edit="closeEdit"
        />
      </ul>
    </template>
  </div>
</template>

<style scoped>
.moment-list {
  display: grid;
  gap: 10px;
}

.moment-group {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.group-head {
  display: grid;
  min-width: 0;
  /* 머리(제목 · 수 · 목록)를 한 덩어리로 — 구분선은 목록 줄 아래에 둔다. 위에 두면 목록 줄이 다음 묶음처럼 보인다. */
  padding-bottom: 2px;
  border-bottom: 1px solid var(--drawer-head-border-color);
  gap: 0;
}

.group-heading {
  margin: 0;
  font: inherit;
}

/* 묶음 머리 = 접기 단추. 줄 전체가 누르는 자리다 (44px). */
.group-toggle {
  display: flex;
  width: 100%;
  min-height: 44px;
  flex-wrap: wrap;
  align-items: baseline;
  padding: 8px 6px;
  border: 0;
  background: transparent;
  color: inherit;
  column-gap: 8px;
  row-gap: 2px;
  text-align: left;
}

.caret {
  flex: none;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
}

/* 드로어의 `.drawer-section-title` 조판이다. 긴 제목은 줄을 바꾼다 (U12). */
.group-title {
  min-width: 0;
  flex: 1 1 12em;
  color: var(--drawer-section-title-text-color);
  font: 11px/1.4 var(--font-mono);
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
}

.group-meta {
  flex: none;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

@media (hover: hover) {
  .group-toggle:hover .group-title,
  .list-link:hover {
    color: var(--row-action-hover-text-color);
  }
}

/* 지금 곡의 묶음. 색과 함께 "· 재생 중" 글자로도 알린다. */
.moment-group.is-current .group-title {
  color: var(--accent-color);
}

.group-lists {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0;
  padding-left: 22px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
  gap: 0 4px;
}

.lists-label {
  margin-right: 2px;
}

/* 목록 이름 — 글자 링크처럼 보이되 누르는 자리는 44px. */
.list-link {
  min-width: 44px;
  min-height: 44px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--drawer-action-text-color);
  font: 11px var(--font-mono);
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.moment-rows {
  display: grid;
  margin: 0;
  padding: 0;
  gap: 5px;
  list-style: none;
}

.more-rows {
  justify-self: start;
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

mark {
  background: transparent;
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: var(--accent-color);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}
</style>
