<script setup lang="ts">
/**
 * 링크로 받은 공유의 미리보기 (ADR 0040) — `ShareLinkDialog` 안.
 *
 * 무엇이 들어 있는지 보이고, 받는 사람이 고른 것만 한다. 누르기 전에는 아무것도 저장하지 않고 재생하지 않는다.
 *
 * | 종류   | 첫째 단추                | 둘째 단추     |
 * | ------ | ------------------------ | ------------- |
 * | 목록   | 보관함에 추가하고 듣기   | 추가만 하기   |
 * | 곡     | 바로 듣기 (저장 안 함)   | 목록에 추가   |
 * | Moment | 그 순간부터 듣기         | Moment 저장   |
 *
 * 재생은 대화상자를 **닫은 뒤에** 한다 — 덮인 플레이어로 소리를 내지 않는다 (ADR 0011). 그래서 재생할 일을
 * `close` 에 실어 셸에 넘기고, 셸이 닫고 나서 부른다. 판단은 `useShareLinkReceive` 가 한다 (규칙 3).
 */
import { computed, inject } from 'vue'

import { ARCHIVE } from '@/features/archive/archiveController'
import { PLAYBACK_COORDINATOR } from '@/features/playback/playbackCoordinator'
import { formatTimestamp } from '@/shared/utils/time'
import { useLibraryStore } from '@/stores/library'

import type { ShareLinkContent } from './shareLink'
import { useShareLinkReceive } from './useShareLinkReceive'

const props = defineProps<{ content: ShareLinkContent; titleId: string }>()
const emit = defineEmits<{ close: [after?: () => void] }>()

const library = useLibraryStore()
const coordinator = inject(PLAYBACK_COORDINATOR, null)
const archive = inject(ARCHIVE, null)
const model = useShareLinkReceive(props.content)

const kind = computed(() => props.content.kind)
const first = computed(() => props.content.tracks[0] ?? null)
const firstMoment = computed(() => props.content.moments[0] ?? null)

const KIND_LABEL = {
  playlist: '공유받은 목록',
  track: '공유받은 곡',
  moment: '공유받은 순간',
} as const

const headline = computed<string>(() => {
  if (kind.value === 'playlist') return model.newListName.value
  return first.value === null ? '' : model.displayTitle(first.value)
})

const lookingUp = computed(
  () => model.lookupTotal.value > 0 && model.lookupDone.value < model.lookupTotal.value,
)

const moments = computed(() => props.content.moments)

/** 목록 · 곡: 고른 곳에 넣고, 넣은 첫 곡부터 듣는다. 실패하면 대화상자에 남아 이유를 보인다. */
async function addAndPlay(): Promise<void> {
  const result = await model.addTracks()
  if (result === null || model.failed.value) return
  emit('close', () => {
    if (result.firstTrackId !== null) coordinator?.playTrack(result.playlistId, result.firstTrackId)
    else coordinator?.playPlaylist(result.playlistId)
  })
}

async function addOnly(): Promise<void> {
  await model.addTracks()
}

/** "추가만 하기" 뒤 — 넣은 목록을 그 첫 곡부터 듣는다. */
function playImported(): void {
  const done = model.imported.value
  if (done === null) return
  emit('close', () => {
    if (done.firstTrackId !== null) coordinator?.playTrack(done.playlistId, done.firstTrackId)
    else coordinator?.playPlaylist(done.playlistId)
  })
}

/** 저장하지 않고 듣는다 — 곡은 처음부터, Moment 는 그 순간부터. 라이브러리에 같은 영상이 있으면 그 목록에서. */
function listenNow(): void {
  const track = first.value
  if (track === null) return
  const at = kind.value === 'moment' ? (firstMoment.value?.atSeconds ?? 0) : 0
  const title = model.displayTitle(track)
  emit('close', () => {
    coordinator?.playMoment({ videoId: track.videoId, atSeconds: at, title })
  })
}

/** 넣은 목록을 보관함 음악 탭에서 연다. */
function openInArchive(): void {
  const done = model.imported.value
  if (done === null) return
  emit('close', () => {
    void library.selectPlaylist(done.playlistId).then(() => {
      archive?.open('music', { showDetail: true })
    })
  })
}
</script>

<template>
  <div class="share-preview">
    <p class="kicker">{{ KIND_LABEL[kind] }}</p>
    <h2 :id="titleId" class="headline">{{ headline }}</h2>
    <p class="meta">
      <template v-if="kind === 'moment' && firstMoment !== null">
        {{ formatTimestamp(firstMoment.atSeconds) }} 부터
      </template>
      <template v-else>곡 {{ content.tracks.length }}개</template>
      <template v-if="kind !== 'moment' && moments.length > 0">
        · Moment {{ moments.length }}개
      </template>
    </p>
    <p class="trust">
      다른 사람이 만든 링크예요. 내용을 확인한 뒤 고르세요 — 누르기 전에는 아무것도 저장하지 않아요.
    </p>
    <p v-if="lookingUp" class="lookup" role="status">
      곡 이름을 YouTube 에서 찾는 중… ({{ model.lookupDone.value }}/{{ model.lookupTotal.value }})
    </p>

    <ol v-if="kind === 'playlist'" class="tracks" aria-label="공유받은 곡">
      <li v-for="(track, index) in content.tracks" :key="`${index}:${track.videoId}`">
        <span class="no" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="title">{{ model.displayTitle(track) }}</span>
      </li>
    </ol>

    <ul
      v-if="kind !== 'playlist' && moments.length > 0"
      class="moments"
      aria-label="공유받은 Moment"
    >
      <li v-for="(moment, index) in moments" :key="`${index}:${moment.atSeconds}`">
        <span class="time">▶ {{ formatTimestamp(moment.atSeconds) }}</span>
        <span class="note" :class="{ 'is-empty': moment.note === '' }">{{
          moment.note === '' ? '메모 없음' : moment.note
        }}</span>
      </li>
    </ul>

    <p v-if="model.sameList.value !== null" class="hint">
      보관함에 곡 구성이 같은 목록 “{{ model.sameList.value.name }}” 이 이미 있어요.
    </p>

    <template v-if="model.imported.value === null || model.failed.value">
      <label v-if="kind !== 'moment'" class="field">
        넣을 곳
        <select v-model="model.target.value" aria-label="넣을 곳" :disabled="model.busy.value">
          <option value="new">새 목록 “{{ model.newListName.value }}”</option>
          <option v-for="item in library.playlists" :key="item.id" :value="item.id">
            기존 목록에 추가 — {{ item.name }}
          </option>
        </select>
      </label>
      <fieldset v-if="kind !== 'moment' && model.duplicateCount.value > 0" class="dupes">
        <legend>이 목록에 이미 있는 같은 영상 {{ model.duplicateCount.value }}곡</legend>
        <label class="check">
          <input v-model="model.duplicates.value" type="radio" value="skip" /> 건너뛰기
        </label>
        <label class="check">
          <input v-model="model.duplicates.value" type="radio" value="add" /> 그래도 추가
        </label>
      </fieldset>
      <label v-if="kind !== 'moment' && moments.length > 0" class="check">
        <input v-model="model.includeMoments.value" type="checkbox" />
        Moments {{ moments.length }}개도 저장 (같은 것은 건너뜀)
      </label>
    </template>

    <ul
      v-if="model.lines.value.length > 0"
      class="results"
      :class="{ 'is-failed': model.failed.value }"
      role="status"
      aria-live="polite"
    >
      <li v-for="line in model.lines.value" :key="line">{{ line }}</li>
    </ul>

    <div class="actions">
      <template v-if="kind === 'playlist'">
        <template v-if="model.imported.value === null || model.failed.value">
          <button
            type="button"
            class="pill pill--strong"
            :disabled="model.busy.value"
            @click="addAndPlay"
          >
            {{ model.busy.value ? '추가하는 중…' : '보관함에 추가하고 듣기' }}
          </button>
          <button type="button" class="pill" :disabled="model.busy.value" @click="addOnly">
            추가만 하기
          </button>
        </template>
        <template v-else>
          <button type="button" class="pill pill--strong" @click="playImported">듣기</button>
          <button type="button" class="pill" @click="openInArchive">보관함에서 보기</button>
        </template>
      </template>

      <template v-else-if="kind === 'track'">
        <button
          type="button"
          class="pill pill--strong"
          :disabled="model.busy.value"
          @click="listenNow"
        >
          바로 듣기
        </button>
        <button
          v-if="model.imported.value === null || model.failed.value"
          type="button"
          class="pill"
          :disabled="model.busy.value"
          @click="addOnly"
        >
          {{ model.busy.value ? '추가하는 중…' : '목록에 추가' }}
        </button>
        <button v-else type="button" class="pill" @click="openInArchive">보관함에서 보기</button>
      </template>

      <template v-else>
        <button
          type="button"
          class="pill pill--strong"
          :disabled="model.busy.value"
          @click="listenNow"
        >
          그 순간부터 듣기
        </button>
        <button
          type="button"
          class="pill"
          :disabled="model.busy.value || (model.lines.value.length > 0 && !model.failed.value)"
          @click="model.saveMoments()"
        >
          {{ model.busy.value ? '저장하는 중…' : 'Moment 저장' }}
        </button>
      </template>

      <button type="button" class="pill" @click="emit('close')">닫기</button>
    </div>
  </div>
</template>

<style scoped>
.kicker {
  margin: 0;
  color: var(--drawer-sub-text-color);
  font: 11px var(--font-mono);
  letter-spacing: 0.1em;
}

.headline {
  margin: 6px 0 0;
  color: var(--drawer-title-text-color);
  font-size: 19px;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.meta,
.trust,
.lookup,
.hint {
  margin: 6px 0 0;
  font: 11px/1.6 var(--font-mono);
}

.meta,
.trust {
  color: var(--drawer-sub-text-color);
}

.hint {
  color: var(--status-warning-text-color);
}

.tracks,
.moments {
  max-height: min(40vh, 300px);
  margin: 12px 0 0;
  padding: 0 4px 0 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.tracks li,
.moments li {
  display: grid;
  min-height: 34px;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--row-border-color);
  gap: 8px;
}

.tracks li {
  grid-template-columns: 24px minmax(0, 1fr);
}

.moments li {
  grid-template-columns: auto minmax(0, 1fr);
}

.no,
.time {
  color: var(--row-meta-text-color);
  font: 11px var(--font-mono);
}

.title,
.note {
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.note.is-empty {
  color: var(--drawer-muted-text-color);
}

.field {
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  font: 11px var(--font-mono);
  gap: 4px;
}

.field select {
  min-height: 44px;
  max-width: 100%;
}

.dupes {
  margin: 8px 0 0;
  padding: 0;
  border: 0;
  font-size: 12px;
}

.check {
  display: flex;
  min-height: 44px;
  align-items: center;
  font-size: 13px;
  gap: 8px;
}

.results {
  margin: 10px 0 0;
  padding-left: 18px;
  font: 11px/1.6 var(--font-mono);
}

.results.is-failed {
  color: var(--status-warning-text-color);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 14px;
  gap: 8px;
}

.pill {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 12px var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}
</style>
