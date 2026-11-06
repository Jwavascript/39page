<script setup lang="ts">
/**
 * 백업 패널 (M8-2). 레코드 편집 오버레이 **바닥**에 선다.
 *
 * 플레이리스트 편집 버튼과 **시각적으로 구분한다.** 성격이 다른 기능이다 —
 * 하나는 이 목록을 고치고, 하나는 앱 전체의 데이터를 파일로 꺼낸다. 구분은
 * 세 가지로 한다.
 *
 * 1. 위에 선(`--rule-color`)을 긋고 `DATA` 라는 **다른 머리말**을 붙인다
 * 2. 강조 버튼(`.pill--strong`)을 쓰지 않는다. 편집 쪽의 `▶ 목록 전체 재생`
 *    이 유일한 강조로 남는다
 * 3. 평문 고지를 **항상** 아래에 둔다. 편집 버튼에는 없는 설명이다
 *
 * 새 색을 만들지 않는다. 드로어가 쓰는 토큰을 그대로 쓰므로 두 테마에서
 * 자동으로 맞는다 (`theme-tokens.spec.ts` 가 레퍼런스에 없는 색을 거부한다).
 *
 * 판단은 `useBackupExport` 가 한다. 이 컴포넌트는 자리와 문구만 정한다
 * (`AGENTS.md` 규칙 3).
 */
import { useBackupExport } from '@/features/backup/useBackupExport'

const backup = useBackupExport()
</script>

<template>
  <section class="backup" aria-labelledby="backup-title">
    <div class="rule" />
    <h3 id="backup-title" class="backup-title">DATA</h3>

    <p v-if="backup.warning.value !== ''" class="backup-warning" role="status">
      {{ backup.warning.value }}
    </p>
    <p v-if="backup.unsavedNotice.value !== ''" class="backup-warning" role="status">
      {{ backup.unsavedNotice.value }}
    </p>

    <div class="backup-actions">
      <button type="button" class="pill" @click="backup.request()">
        {{ backup.isRecovery.value ? '복구본 내보내기' : 'JSON 백업 내보내기' }}
      </button>
      <span class="backup-count">
        플레이리스트 {{ backup.counts.value.playlists }}개 · {{ backup.counts.value.tracks }}곡
      </span>
    </div>

    <!--
      복구본은 **명시적 선택**을 거친다. 온전하지 않은 파일을 나중에 전체
      백업으로 오인하면 잃은 것을 모르고 덮어쓸 수 있다.
    -->
    <div
      v-if="backup.needsConfirm.value"
      class="confirm"
      role="alertdialog"
      aria-label="복구본 내보내기 확인"
    >
      <p class="confirm-text">
        온전한 전체 백업이 아닙니다. 파일에 복구본 표시가 들어갑니다. 계속할까요?
      </p>
      <div class="backup-actions">
        <button type="button" class="pill pill--strong" @click="backup.confirm()">
          복구본으로 내보내기
        </button>
        <button type="button" class="pill" @click="backup.cancel()">취소</button>
      </div>
    </div>

    <p
      v-if="backup.notice.value !== ''"
      class="backup-result"
      :class="{ 'is-failed': backup.failed.value }"
      role="status"
      aria-live="polite"
    >
      {{ backup.notice.value }}
    </p>

    <p class="backup-note">{{ backup.plaintextNotice }}</p>
  </section>
</template>

<style scoped>
.backup {
  margin-top: 18px;
}

/* 드로어의 `.rule` 과 같은 값이다. 편집 영역과 끊어 보이게 한다. */
.rule {
  height: 1px;
  margin-bottom: 14px;
  background: var(--rule-color);
}

/* 드로어의 `.drawer-section-title` 과 같은 조판이다. */
.backup-title {
  margin: 0 0 8px;
  color: var(--drawer-section-title-text-color);
  font: 10px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.12em;
}

/* 승인된 디자인의 `.pill` 값을 따른다. */
.pill {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

.pill:hover {
  background: var(--pill-surface-hover-color);
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.backup-count {
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

.backup-warning {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.backup-result {
  margin: 10px 0 0;
  color: var(--row-meta-text-color);
  font: 10px/1.6 var(--font-mono);
}

.backup-result.is-failed {
  color: var(--error-text-color);
}

.backup-note {
  margin: 8px 0 0;
  color: var(--drawer-muted-text-color);
  font-size: 11px;
  line-height: 1.6;
}

.confirm {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.confirm-text {
  margin: 0 0 10px;
  color: var(--row-text-color);
  font: 12px/1.5 var(--font-mono);
}
</style>
