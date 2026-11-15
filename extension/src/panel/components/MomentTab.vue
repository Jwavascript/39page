<script setup lang="ts">
/**
 * Moment 저장 (M11-5B) — 잡은 시점과 메모를 보고 **저장을 눌러야** 저장한다. 메모를 쓰는 동안 영상이
 * 재생돼도 시점은 그대로다. 플레이리스트와 무관하다.
 */
import { computed } from 'vue'

import { CAPTURE_REFUSED, formatTime } from '../panelCopy'
import type { PanelModel } from '../usePanel'
import { MAX_NOTE, type Saves } from '../useSaves'

import SaveFeedback from './SaveFeedback.vue'

const props = defineProps<{ panel: PanelModel; saves: Saves; disabled: boolean }>()
const emit = defineEmits<{ collect: []; music: [] }>()

const p = props.panel
const s = props.saves

const shot = computed(() => {
  const c = p.capture.value
  const v = p.video.value
  return c?.status === 'captured' && v !== null && c.videoId === v.videoId ? c : null
})

const sameSecond = computed<boolean>(
  () => shot.value !== null && s.momentsHere.value.includes(shot.value.atSeconds),
)

const canSave = computed<boolean>(
  () =>
    !props.disabled &&
    shot.value !== null &&
    s.note.value.length <= MAX_NOTE &&
    s.moment.state.value.phase !== 'saving',
)

const success = computed<string>(() => {
  const state = s.moment.state.value
  if (state.phase !== 'done') return ''
  const at = typeof state.data.atSeconds === 'number' ? formatTime(state.data.atSeconds) : ''
  const note = state.data.noteSaved === true ? '메모와 함께' : '메모 없이'
  return `${at} 을 ${note} 저장했어요. 39page 의 Moments 보관함에서 볼 수 있어요.`
})
</script>

<template>
  <section class="tab-body" aria-label="Moment 저장">
    <div class="capture" aria-live="polite">
      <template v-if="shot">
        <p class="capture-time">
          <span class="label">잡은 시점</span>
          <strong>{{ formatTime(shot.atSeconds) }}</strong>
        </p>
        <p class="muted">메모를 쓰는 동안 영상이 재생돼도 이 시점으로 저장돼요.</p>
      </template>
      <p v-else-if="p.capture.value?.status === 'refused'" class="muted" role="alert">
        {{ CAPTURE_REFUSED[p.capture.value.reason] }}
      </p>
      <p v-else class="muted">아직 시점을 잡지 않았어요.</p>
      <p v-if="p.captureError.value !== ''" class="muted" role="alert">
        {{ p.captureError.value }}
      </p>
      <button
        type="button"
        class="btn"
        :disabled="disabled || p.capturing.value || p.video.value === null"
        :aria-busy="p.capturing.value"
        @click="p.recapture()"
      >
        {{ shot ? '지금 시점으로 다시 잡기' : '지금 시점 잡기' }}
      </button>
    </div>

    <p v-if="sameSecond" class="muted" role="note">
      이 영상의 같은 시점에 저장한 Moment 가 이미 있어요. 저장하면 하나 더 생겨요.
    </p>

    <div class="field-row">
      <label for="panel-note" class="label">메모 (선택)</label>
      <textarea
        id="panel-note"
        v-model="s.note.value"
        class="field area"
        rows="3"
        :maxlength="MAX_NOTE"
        aria-describedby="panel-note-count"
      />
      <p id="panel-note-count" class="counter">{{ s.note.value.length }} / {{ MAX_NOTE }}</p>
    </div>

    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="!canSave"
        :aria-busy="s.moment.state.value.phase === 'saving'"
        @click="s.saveMoment()"
      >
        Moment 저장
      </button>
    </div>

    <SaveFeedback
      :state="s.moment.state.value"
      :success="success"
      @check="s.moment.check()"
      @retry="s.moment.retry()"
      @collect="emit('collect')"
      @reconnect="s.loadLists()"
    />
    <p v-if="s.moment.state.value.phase === 'done'" class="next">
      <button type="button" class="link" @click="emit('music')">
        이 음악을 플레이리스트에 담기
      </button>
    </p>
  </section>
</template>
