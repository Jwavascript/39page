<script setup lang="ts">
/**
 * 공유 (M12-4 파일 · ADR 0040 링크) — 데이터 · 백업 대화상자 안.
 *
 * 대상: 목록 하나(또는 그 목록의 곡 하나), 또는 Moment 하나(링크로만).
 * - 링크로 공유 (`ShareLinkBox`): 내용을 주소 조각에 담은 링크 — 파일을 올릴 수 없는 게시판 · 메신저용. 서버가 없다.
 * - 파일로 공유 (ZIP): 그 곡들 · 그림 · (켰을 때만) Moments 를 ZIP 하나로.
 * 가져오기: 미리보기 → 새 목록 / 기존 목록에 추가 · 같은 영상 처리 · Moments 넣기 → 가져오기. 링크로 받은 공유는
 * 링크를 열면 대시보드의 미리보기(`ShareLinkDialog`)가 받는다.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { ShareRequest } from '@/shared/types/share'

import { formatBytes } from '@/shared/utils/bytes'
import { formatTimestamp } from '@/shared/utils/time'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'

import ShareLinkBox from './ShareLinkBox.vue'
import { useShareExport, useShareImport } from './useShare'
import type { ShareLinkTarget } from './useShareLink'

const library = useLibraryStore()
const props = defineProps<{ request?: ShareRequest | null }>()
const exportHeading = ref<HTMLElement | null>(null)
function focusExport(): void {
  exportHeading.value?.focus()
}
defineExpose({ focusExport })
const moments = useMomentsStore()
const share = useShareExport()
const incoming = useShareImport()

const playlistId = ref<string>(library.selectedPlaylistId ?? library.playlists[0]?.id ?? '')
/** `''` = 목록 전체. */
const trackId = ref('')
const includeMoments = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const playlist = computed(() => library.getPlaylist(playlistId.value) ?? null)
watch(playlistId, () => (trackId.value = ''), { flush: 'sync' })
const targetError = ref('')

/** Moment 하나를 공유하는 중이면 그 id (링크로만). `''` 이면 목록 · 곡을 고르는 보통 모드. */
const momentId = ref('')
const moment = computed(() =>
  momentId.value === '' ? null : (moments.moments.find((m) => m.id === momentId.value) ?? null),
)
/** Moment 의 곡 이름 — 라이브러리(고른 목록 먼저)의 지금 이름, 없으면 Moment 를 저장할 때의 제목. */
const momentTitle = computed<string>(() => {
  const current = moment.value
  if (current === null) return ''
  const lists = [library.selectedPlaylist, ...library.playlists]
  for (const list of lists) {
    const found = list?.tracks.find((track) => track.videoId === current.videoId)
    if (found !== undefined) return found.title
  }
  return current.title
})

watch(
  () => props.request?.seq,
  async () => {
    const request = props.request
    if (request == null) return
    includeMoments.value = false
    if ('momentId' in request) {
      const exists = moments.moments.some((m) => m.id === request.momentId)
      momentId.value = exists ? request.momentId : ''
      targetError.value = exists ? '' : '공유할 Moment 가 사라졌어요. 대상을 다시 골라 주세요.'
    } else {
      momentId.value = ''
      const target = library.getPlaylist(request.playlistId)
      const valid =
        target !== undefined &&
        (request.trackId === undefined ||
          target.tracks.some((track) => track.id === request.trackId))
      playlistId.value = valid ? request.playlistId : ''
      trackId.value = valid ? (request.trackId ?? '') : ''
      targetError.value = valid ? '' : '공유할 목록이나 곡이 사라졌어요. 대상을 다시 골라 주세요.'
    }
    await nextTick()
    focusExport()
  },
  { immediate: true },
)

/** 링크로 공유할 대상. */
const linkTarget = computed<ShareLinkTarget | null>(() => {
  if (moment.value !== null) {
    return { kind: 'moment', moment: moment.value, title: momentTitle.value }
  }
  const list = playlist.value
  if (list === null || list.tracks.length === 0) return null
  if (trackId.value === '') return { kind: 'playlist', playlist: list }
  const track = list.tracks.find((item) => item.id === trackId.value)
  return track === undefined ? null : { kind: 'track', playlist: list, track }
})

/** 넣을 Moments 수 — 켜기 전에 몇 개가 나가는지 보인다. */
const momentCount = computed(() => {
  const list = playlist.value
  if (list === null) return 0
  const ids = new Set(
    (trackId.value === '' ? list.tracks : list.tracks.filter((t) => t.id === trackId.value)).map(
      (t) => t.videoId,
    ),
  )
  return moments.moments.filter((m) => ids.has(m.videoId)).length
})

function make(): void {
  if (
    playlist.value === null ||
    (trackId.value !== '' && !playlist.value.tracks.some((track) => track.id === trackId.value))
  )
    return
  void share.exportShare({
    playlistId: playlist.value.id,
    ...(trackId.value === '' ? {} : { trackId: trackId.value }),
    includeMoments: includeMoments.value,
  })
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) void incoming.selectFile(file)
}
</script>

<template>
  <section class="share" aria-labelledby="share-title">
    <div class="rule" />
    <h3 id="share-title" ref="exportHeading" class="share-title" tabindex="-1">SHARE · 공유</h3>
    <p v-if="targetError" role="status">{{ targetError }}</p>

    <!-- Moment 하나 — 링크로만 공유한다. 목록 · 곡 고르기로 돌아갈 수 있다. -->
    <div v-if="moment !== null" class="moment-target">
      <p>
        Moment —
        <strong>{{ momentTitle === '' ? `YouTube · ${moment.videoId}` : momentTitle }}</strong> ·
        {{ formatTimestamp(moment.atSeconds) }}
      </p>
      <button type="button" class="pill" @click="momentId = ''">목록 · 곡 공유로 바꾸기</button>
    </div>

    <div v-else class="share-form">
      <label class="field">
        목록
        <select v-model="playlistId" aria-label="공유할 목록">
          <option v-for="item in library.playlists" :key="item.id" :value="item.id">
            {{ item.name }} ({{ item.tracks.length }}곡)
          </option>
        </select>
      </label>
      <label class="field">
        범위
        <select v-model="trackId" aria-label="공유할 범위" :disabled="playlist === null">
          <option value="">목록 전체</option>
          <option v-for="track in playlist?.tracks ?? []" :key="track.id" :value="track.id">
            한 곡 — {{ track.title }}
          </option>
        </select>
      </label>
    </div>

    <ShareLinkBox :target="linkTarget" />

    <h4 v-if="moment === null" class="share-sub">파일로 공유 (ZIP)</h4>
    <div v-if="moment === null" class="share-form">
      <label class="check">
        <input v-model="includeMoments" type="checkbox" />
        이 곡들의 Moments {{ momentCount }}개도 넣기
      </label>
      <button
        type="button"
        class="pill"
        :disabled="playlist === null || playlist.tracks.length === 0 || share.busy.value"
        @click="make"
      >
        {{ share.busy.value ? '만드는 중…' : '공유 파일 만들기' }}
      </button>
    </div>
    <p v-if="moment === null" class="share-note">
      앨범아트까지 넘길 때 쓰세요. 고른 곡의 제목 · 영상 · 순서 · 앨범아트만 들어갑니다. 다른 목록 ·
      테마는 들어가지 않고, Moments 는 켰을 때만.
    </p>
    <p
      v-if="share.notice.value !== ''"
      class="share-result"
      :class="{ 'is-failed': share.failed.value }"
      role="status"
      aria-live="polite"
    >
      {{ share.notice.value }}
    </p>

    <div class="share-form">
      <button
        type="button"
        class="pill"
        :disabled="incoming.busy.value"
        @click="fileInput?.click()"
      >
        {{ incoming.busy.value ? '확인하는 중…' : '공유 파일 가져오기' }}
      </button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="application/zip,.zip"
        aria-label="공유 파일 선택"
        @change="onFile"
      />
    </div>
    <p
      v-if="incoming.notice.value !== ''"
      class="share-result"
      :class="{ 'is-failed': incoming.failed.value }"
      role="status"
    >
      {{ incoming.notice.value }}
    </p>

    <div
      v-if="incoming.preview.value !== null"
      class="share-preview"
      role="group"
      aria-label="공유 파일 가져오기 미리보기"
    >
      <p>
        <strong>{{ incoming.preview.value.name }}</strong> —
        {{ incoming.preview.value.kind === 'track' ? '한 곡' : '목록' }} · 곡
        {{ incoming.preview.value.tracks }}개 · 그림 {{ incoming.preview.value.images }}개 ({{
          formatBytes(incoming.preview.value.bytes)
        }})
        <template v-if="incoming.preview.value.moments !== null">
          · Moment {{ incoming.preview.value.moments }}개
        </template>
      </p>
      <p v-if="incoming.preview.value.droppedArtwork > 0" class="share-warning">
        손상된 그림 {{ incoming.preview.value.droppedArtwork }}개는 받지 않습니다 (그 곡은 썸네일).
      </p>
      <label class="field">
        넣을 곳
        <select v-model="incoming.target.value" aria-label="넣을 곳">
          <option value="new">새 목록 “{{ incoming.preview.value.name }}”</option>
          <option v-for="item in library.playlists" :key="item.id" :value="item.id">
            기존 목록에 추가 — {{ item.name }}
          </option>
        </select>
      </label>
      <fieldset v-if="incoming.preview.value.duplicates > 0" class="dupes">
        <legend>이 목록에 이미 있는 같은 영상 {{ incoming.preview.value.duplicates }}곡</legend>
        <label class="check">
          <input v-model="incoming.duplicates.value" type="radio" value="skip" /> 건너뛰기
        </label>
        <label class="check">
          <input v-model="incoming.duplicates.value" type="radio" value="add" /> 그래도 추가
        </label>
      </fieldset>
      <label v-if="incoming.preview.value.moments !== null" class="check">
        <input v-model="incoming.includeMoments.value" type="checkbox" />
        Moments {{ incoming.preview.value.moments }}개도 가져오기 (같은 것은 건너뜀)
      </label>
      <div class="share-form">
        <button
          type="button"
          class="pill pill--strong"
          :disabled="incoming.busy.value"
          @click="incoming.apply()"
        >
          가져오기
        </button>
        <button type="button" class="pill" @click="incoming.cancel()">취소</button>
      </div>
    </div>

    <ul
      v-if="incoming.results.value.length > 0"
      class="share-results"
      aria-label="공유 가져오기 결과"
    >
      <li v-for="line in incoming.results.value" :key="line">{{ line }}</li>
    </ul>
  </section>
</template>

<style scoped>
.share {
  margin-top: 18px;
}

.rule {
  height: 1px;
  margin-bottom: 14px;
  background: var(--rule-color);
}

.share-sub {
  margin: 12px 0 0;
  color: var(--drawer-title-text-color);
  font: 12px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.08em;
}

.moment-target {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 8px 0;
  font-size: 13px;
  gap: 8px;
}

.moment-target p {
  min-width: 0;
  flex: 1 1 200px;
  margin: 0;
  overflow-wrap: anywhere;
}

.share-title {
  margin: 0 0 8px;
  color: var(--drawer-section-title-text-color);
  font: 10px var(--font-mono);
  letter-spacing: 0.12em;
}

.share-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 8px 0;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  font: 11px var(--font-mono);
  gap: 4px;
}

.field select {
  min-height: 40px;
  max-width: 260px;
}

.check {
  display: flex;
  min-height: 44px;
  align-items: center;
  font-size: 13px;
  gap: 8px;
}

.share-note,
.share-result,
.share-warning,
.share-results {
  margin: 4px 0;
  font: 11px/1.6 var(--font-mono);
}

.share-result.is-failed,
.share-warning {
  color: var(--status-warning-text-color);
}

.share-preview {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--pill-border-color);
}

.share-preview p {
  margin: 0 0 6px;
  font-size: 13px;
}

.dupes {
  margin: 6px 0;
  padding: 0;
  border: 0;
  font-size: 12px;
}

.file-input {
  display: none;
}

.pill {
  min-height: 44px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
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
