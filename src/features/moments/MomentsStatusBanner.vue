<script setup lang="ts">
/**
 * Moments 저장 상태 안내 (M9-4).
 *
 * `LibraryStatusBanner` 와 같은 원칙이다 — ADR 0007 의 세 상태를 구분해 알리고,
 * 저장되지 않은 변경을 저장된 것처럼 보이게 하지 않는다. 두 키는 따로 보호되므로
 * (ADR 0019 결정 3) 배너도 따로다. 라이브러리가 멀쩡해도 Moments 만 보호 상태일
 * 수 있다.
 *
 * "복구" · "초기화" 버튼을 만들지 않는다. 보호된 원본을 지우거나 덮어쓰는
 * 경로는 백업 가져오기(M9-5)뿐이다.
 */
import { computed } from 'vue'

import { useMomentsStore } from '@/stores/moments'

const moments = useMomentsStore()

const PROTECTED_DETAIL: Record<string, string> = {
  malformed: '저장된 Moments 를 읽을 수 없습니다.',
  invalid: '저장된 Moments 의 형식이 맞지 않습니다.',
  'version-mismatch': '지원하지 않는 버전의 Moments 입니다.',
  'partial-recovery': '일부 순간만 복구했습니다.',
}

interface Notice {
  title: string
  detail: string
}

const notice = computed<Notice | null>(() => {
  if (moments.status === 'protected') {
    const reason = moments.protectedReason ?? 'invalid'
    return {
      title: 'Moments 자동 저장이 중단되었습니다',
      detail: `${PROTECTED_DETAIL[reason] ?? ''} 원본은 보존 중입니다. 지금 저장·수정·삭제한 순간은 이 세션에서만 유지됩니다.`,
    }
  }

  if (moments.status === 'unavailable') {
    return {
      title: '저장소를 쓸 수 없습니다',
      detail: '브라우저 저장소에 접근할 수 없어 순간이 저장되지 않습니다.',
    }
  }

  if (moments.lastWriteFailure !== null) {
    return {
      title: '저장에 실패했습니다',
      detail:
        moments.lastWriteFailure === 'quota-exceeded'
          ? '저장 공간이 부족합니다. 마지막 변경이 저장되지 않았습니다.'
          : '마지막 변경이 저장되지 않았습니다.',
    }
  }

  return null
})
</script>

<template>
  <!-- 항상 존재하는 라이브 영역. 안내가 생긴 순간 보조기기가 읽는다. -->
  <div class="moments-status" role="status" aria-live="polite">
    <p v-if="notice !== null" class="moments-notice">
      <strong class="moments-notice-title">{{ notice.title }}</strong>
      <span class="moments-notice-detail">{{ notice.detail }}</span>
    </p>
  </div>
</template>

<style scoped>
/*
 * `LibraryStatusBanner` 와 같은 값이다. 같은 종류의 안내가 같은 모양을 갖는다.
 *
 * 클래스 이름은 **다르게** 둔다. 두 배너가 한 화면에 함께 있으므로 같은 이름을
 * 쓰면 "라이브러리 배너" 를 찾는 코드가 이쪽을 집는다 (M9-4 에서 실제로 테스트
 * 세 개가 그렇게 깨졌다).
 */
.moments-status {
  min-height: 0;
}

.moments-notice {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--status-warning-text-color);
  background: var(--row-surface-color);
  font-family: var(--font-mono);
  gap: 4px;
}

.moments-notice-title {
  color: var(--status-warning-text-color);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.moments-notice-detail {
  color: var(--drawer-muted-text-color);
  font-size: 10px;
  line-height: 1.6;
}
</style>
