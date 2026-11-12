<script setup lang="ts">
/**
 * 음악 담기 (M11-5B) — 기존 목록을 고르거나 새 목록을 만들어 지금(카드의) 영상을 담는다.
 * 같은 영상이 이미 있으면 그렇다고 보이고, "한 번 더 담기" 를 골라야 담는다 (중복 허용이지만 묻는다).
 */
import { computed } from 'vue'

import { MAX_NAME, type Saves } from '../useSaves'

import SaveFeedback from './SaveFeedback.vue'

const props = defineProps<{ saves: Saves; disabled: boolean }>()
const emit = defineEmits<{ collect: []; moment: [] }>()

const s = props.saves

const already = computed<readonly number[]>(() => {
  const state = s.music.state.value
  if (state.phase === 'error' && state.error.code === 'already-in-playlist') {
    return (state.error.detail?.positions as number[] | undefined) ?? []
  }
  return s.selectedList.value?.positions ?? []
})

const canSave = computed<boolean>(
  () =>
    !props.disabled &&
    s.music.state.value.phase !== 'saving' &&
    (s.creating.value ? s.newName.value.trim() !== '' : s.selectedList.value !== null) &&
    (s.creating.value || already.value.length === 0 || s.allowDuplicate.value),
)

const success = computed<string>(() => {
  const state = s.music.state.value
  if (state.phase !== 'done') return ''
  const d = state.data
  const name = String(d.playlistName ?? '')
  const where = typeof d.position === 'number' ? ` · ${String(d.position)}번째` : ''
  return d.created === true
    ? `새 플레이리스트 ‘${name}’ 를 만들고 담았어요${where}.`
    : `‘${name}’ 에 담았어요${where}.`
})

const partial = computed<string>(() => {
  const state = s.music.state.value
  return state.phase === 'partial'
    ? `플레이리스트 ‘${state.playlistName}’ 는 만들었지만 곡은 아직 담지 못했어요. 다시 담으면 그 목록에 담아요 — 목록이 또 생기지 않아요.`
    : ''
})

function confirmDuplicate(): void {
  s.allowDuplicate.value = true
  void s.saveMusic()
}
</script>

<template>
  <section class="tab-body" aria-label="음악 담기">
    <p v-if="s.listPhase.value === 'loading'" class="muted" role="status">
      39page 플레이리스트를 불러오는 중…
    </p>
    <p v-else-if="s.listPhase.value === 'failed'" class="muted" role="alert">
      플레이리스트를 불러오지 못했어요.
      <button type="button" class="link" @click="s.loadLists()">다시 불러오기</button>
    </p>
    <p v-else-if="s.listPhase.value === 'blocked'" class="muted" role="alert">
      39page 의 플레이리스트를 보호하는 중이라 지금은 담을 수 없어요. 39page 에서 상태를 확인해
      주세요.
    </p>

    <fieldset v-if="s.listPhase.value === 'ready'" class="lists" :disabled="disabled">
      <legend>어느 플레이리스트에 담을까요?</legend>
      <label v-for="list in s.lists.value" :key="list.id" class="list-row">
        <input
          v-model="s.selected.value"
          type="radio"
          name="playlist"
          :value="list.id"
          @change="s.creating.value = false"
        />
        <span class="list-name">{{ list.name }}</span>
        <span class="list-meta">
          {{ list.trackCount }}곡<template v-if="list.positions.length > 0">
            · 이미 {{ list.positions.join(', ') }}번째</template
          >
        </span>
      </label>
      <p v-if="s.lists.value.length === 0" class="muted">
        아직 플레이리스트가 없어요. 새로 만들어 담아 보세요.
      </p>

      <label class="list-row new">
        <input
          v-model="s.creating.value"
          type="radio"
          name="playlist"
          :value="true"
          @change="s.selected.value = null"
        />
        <span class="list-name">＋ 새 플레이리스트 만들기</span>
      </label>
      <div v-if="s.creating.value" class="field-row">
        <label for="panel-new-name" class="label">새 플레이리스트 이름</label>
        <input
          id="panel-new-name"
          v-model="s.newName.value"
          class="field"
          type="text"
          :maxlength="MAX_NAME"
          autocomplete="off"
          placeholder="예: 새벽 드라이브"
        />
      </div>
    </fieldset>

    <div
      v-if="!s.creating.value && already.length > 0 && s.selectedList.value"
      class="dup"
      role="note"
    >
      <p>
        이 영상은 ‘{{ s.selectedList.value.name }}’ 에 이미 있어요 ({{ already.join(', ') }}번째).
      </p>
      <label class="check">
        <input v-model="s.allowDuplicate.value" type="checkbox" /> 그래도 한 번 더 담기
      </label>
    </div>

    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="!canSave"
        :aria-busy="s.music.state.value.phase === 'saving'"
        @click="s.saveMusic()"
      >
        {{ s.creating.value ? '만들고 담기' : '이 플레이리스트에 담기' }}
      </button>
    </div>

    <SaveFeedback
      :state="s.music.state.value"
      :success="success"
      :partial="partial"
      @check="s.music.check()"
      @retry="s.retryMusic()"
      @collect="emit('collect')"
      @reconnect="s.loadLists()"
    />
    <p
      v-if="
        s.music.state.value.phase === 'error' &&
        s.music.state.value.error.code === 'already-in-playlist'
      "
      class="actions"
    >
      <button type="button" class="btn" @click="confirmDuplicate">한 번 더 담기</button>
    </p>
    <p v-if="s.music.state.value.phase === 'done'" class="next">
      <button type="button" class="link" @click="emit('moment')">이 순간도 Moment 로 저장</button>
    </p>
  </section>
</template>
