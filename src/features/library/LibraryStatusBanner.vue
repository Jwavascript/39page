<script setup lang="ts">
/**
 * 저장 상태 안내.
 *
 * ADR 0007 의 세 상태를 구분해 알린다. 저장되지 않은 변경을 저장된 것처럼
 * 보이게 하지 않는 것이 목적이다.
 *
 * 동작하지 않는 "복구" · "초기화" 버튼을 만들지 않는다. 보호된 데이터를
 * 지우거나 덮어쓰는 기능은 별도의 안전한 작업으로 설계한다.
 */
import { computed } from 'vue'

import { useLibraryStore } from '@/stores/library'

const library = useLibraryStore()

const PROTECTED_DETAIL: Record<string, string> = {
  malformed: '저장된 데이터를 읽을 수 없습니다.',
  invalid: '저장된 데이터의 형식이 맞지 않습니다.',
  'version-mismatch': '지원하지 않는 버전의 데이터입니다.',
  'partial-recovery': '일부 항목만 복구했습니다.',
}

interface Notice {
  tone: 'warning' | 'info'
  title: string
  detail: string
}

const notice = computed<Notice | null>(() => {
  if (library.status === 'protected') {
    const reason = library.protectedReason ?? 'invalid'
    return {
      tone: 'warning',
      title: '자동 저장이 중단되었습니다',
      detail: `${PROTECTED_DETAIL[reason] ?? ''} 원본 데이터는 보존 중입니다. 지금의 변경은 이 세션에서만 유지됩니다.`,
    }
  }

  if (library.status === 'unavailable') {
    return {
      tone: 'warning',
      title: '저장소를 쓸 수 없습니다',
      detail: '브라우저 저장소에 접근할 수 없어 변경 내용이 저장되지 않습니다.',
    }
  }

  if (library.externalChange?.discardedUnsaved) {
    return {
      tone: 'info',
      title: '다른 탭의 변경을 불러왔습니다',
      detail:
        '다른 탭에서 라이브러리가 바뀌어 최신 내용으로 맞췄습니다. 이 탭에서 저장하지 못했던 변경은 반영되지 않았습니다.',
    }
  }

  if (library.lastWriteFailure !== null) {
    return {
      tone: 'warning',
      title: '저장에 실패했습니다',
      detail:
        library.lastWriteFailure === 'quota-exceeded'
          ? '저장 공간이 부족합니다. 변경 내용이 저장되지 않았습니다.'
          : '변경 내용이 저장되지 않았습니다.',
    }
  }

  return null
})
</script>

<template>
  <!--
    항상 존재하는 라이브 영역. 메시지가 생겼을 때 보조기기가 읽는다.
    role="status" 는 방해하지 않는 안내에 맞다.
  -->
  <div class="status-region" role="status" aria-live="polite">
    <p v-if="notice !== null" class="notice" :class="`notice--${notice.tone}`">
      <strong class="notice-title">{{ notice.title }}</strong>
      <span class="notice-detail">{{ notice.detail }}</span>
    </p>
  </div>
</template>

<style scoped>
.status-region {
  min-height: 0;
}

.notice {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--row-border-color);
  background: var(--row-surface-color);
  font-family: var(--font-mono);
  gap: 4px;
}

.notice--warning {
  border-color: var(--status-warning-text-color);
}

.notice-title {
  color: var(--status-warning-text-color);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.notice-detail {
  color: var(--drawer-muted-text-color);
  font-size: 10px;
  line-height: 1.6;
}
</style>
