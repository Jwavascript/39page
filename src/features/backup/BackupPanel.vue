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
 * 판단은 `useBackupExport` · `useBackupImport` 가 한다. 이 컴포넌트는 자리와
 * 문구만 정한다 (`AGENTS.md` 규칙 3).
 *
 * M8-3 에서 가져오기가 같은 패널에 들어왔다. 내보내기와 가져오기가 `DATA`
 * 머리말 아래에 나란히 선다.
 *
 * ADR 0043 — 다른 기기로 옮기는 용도로만 남긴다. 보이는 것은 "전체 백업 내보내기" · "백업 가져오기" 두 단추뿐이고 설명
 * 글(평문 고지 · 개수 · JSON 안내)을 두지 않는다. JSON 내보내기는 저장된 데이터를 읽지 못했을 때의 "복구본 내보내기" 로만
 * 남는다. 가져오기는 ZIP · JSON 을 모두 받는다.
 */
import { ref } from 'vue'

import { useBackupExport } from '@/features/backup/useBackupExport'
import {
  describeWarning,
  useBackupImport,
  type SectionOutcome,
} from '@/features/backup/useBackupImport'
import { useFullBackupExport, useFullBackupImport } from '@/features/backup/useFullBackup'
import { looksLikeZip } from '@/features/backup/zipPackage'
import { formatBytes } from '@/shared/utils/bytes'
import { useArtworkStore } from '@/stores/artwork'
import { useCustomThemeStore } from '@/stores/customTheme'

const backup = useBackupExport()
const restore = useBackupImport()
/** 앨범아트를 포함한 전체 백업 (M12-4, ADR 0034). 가져오기는 위 JSON 가져오기를 감싼다. */
const full = useFullBackupExport()
const fullRestore = useFullBackupImport(restore)
const artwork = useArtworkStore()
const customTheme = useCustomThemeStore()

/**
 * 파일 입력. 숨겨 두고 버튼으로 연다.
 *
 * `<input type="file">` 의 기본 모양은 테마를 따르지 않는다. 승인된 `.pill` 로
 * 열고 입력은 접근성 트리에만 남긴다.
 */
const fileInput = ref<HTMLInputElement | null>(null)

/** 섹션별 결과의 말 (M9-5). "저장됨" 만이 영구 반영이다. */
const RESULT_LABEL: Readonly<Record<SectionOutcome, string>> = {
  saved: '저장됨',
  unsaved: '저장되지 않음 (새로고침하면 사라짐)',
  held: '보류',
  kept: '유지',
  skipped: '가져오지 않음',
}

function pickFile(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 같은 파일을 다시 고를 수 있어야 한다. 값을 비운다.
  input.value = ''
  if (file === undefined) return
  // ZIP(전체 백업) 인지 내용으로 본다 — 확장자를 믿지 않는다. 아니면 기존 JSON 가져오기.
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  } catch {
    head = new Uint8Array()
  }
  if (looksLikeZip(head)) {
    fullRestore.cancel()
    await fullRestore.selectZip(file)
  } else {
    fullRestore.cancel()
    await restore.selectFile(file)
  }
}

function applyImport(): void {
  if (fullRestore.active.value) void fullRestore.apply()
  else void restore.apply()
}

function cancelImport(): void {
  if (fullRestore.active.value) fullRestore.cancel()
  else restore.cancel()
}
</script>

<template>
  <section class="backup" aria-label="백업">
    <p v-if="backup.warning.value !== ''" class="backup-warning" role="status">
      {{ backup.warning.value }}
    </p>
    <p v-if="backup.unsavedNotice.value !== ''" class="backup-warning" role="status">
      {{ backup.unsavedNotice.value }}
    </p>

    <!-- 다른 기기로 옮기기 — 단추 둘뿐이다 (ADR 0043). 전체 백업은 앨범아트까지 담은 ZIP 이다 (M12-4). -->
    <div class="backup-actions">
      <button
        type="button"
        class="pill pill--strong full-backup"
        :disabled="full.busy.value"
        :aria-busy="full.busy.value ? 'true' : 'false'"
        @click="full.exportZip()"
      >
        {{ full.busy.value ? '전체 백업 만드는 중…' : '전체 백업 내보내기' }}
      </button>
      <button
        type="button"
        class="pill backup-import"
        :disabled="fullRestore.reading.value"
        @click="pickFile"
      >
        {{ fullRestore.reading.value ? '파일 확인하는 중…' : '백업 가져오기' }}
      </button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="application/zip,.zip,application/json,.json"
        aria-label="백업 파일 선택 (ZIP 또는 JSON)"
        @change="onFileChange"
      />
    </div>
    <p
      v-if="full.notice.value !== ''"
      class="full-result"
      :class="{ 'is-failed': full.failed.value }"
      role="status"
      aria-live="polite"
    >
      {{ full.notice.value }}
    </p>

    <!--
      저장된 데이터를 읽지 못한 상태에서만 — 읽은 만큼을 복구본(JSON)으로 꺼내는 길. **명시적 선택**을 거친다. 온전하지
      않은 파일을 나중에 전체 백업으로 오인하면 잃은 것을 모르고 덮어쓸 수 있다.
    -->
    <div v-if="backup.isRecovery.value" class="backup-actions">
      <button type="button" class="pill" @click="backup.request()">복구본 내보내기</button>
    </div>
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

    <p
      v-if="fullRestore.notice.value !== ''"
      class="backup-result is-failed"
      role="status"
      aria-live="polite"
    >
      {{ fullRestore.notice.value }}
    </p>

    <p
      v-if="restore.notice.value !== ''"
      class="backup-result"
      :class="{ 'is-failed': restore.failed.value }"
      role="status"
      aria-live="polite"
    >
      {{ restore.notice.value }}
    </p>

    <!--
      섹션별 결과 (M9-5). 플레이리스트 · Moments · 테마를 **따로** 적는다 —
      하나라도 저장되지 않았으면 그 줄이 그렇게 말한다.
    -->
    <ul v-if="restore.results.value.length > 0" class="result-list" aria-label="섹션별 복원 결과">
      <li
        v-for="result in restore.results.value"
        :key="result.name"
        :class="`result--${result.outcome}`"
      >
        <strong>{{ result.name }}</strong> — {{ RESULT_LABEL[result.outcome] }} ·
        {{ result.detail }}
      </li>
    </ul>

    <!-- 앨범아트 단계의 결과 (ZIP 복원, M12-4). 곡과 따로 적는다. -->
    <p
      v-if="fullRestore.artworkResult.value !== null"
      class="backup-result artwork-result"
      :class="{ 'is-failed': fullRestore.artworkResult.value.outcome !== 'saved' }"
      role="status"
    >
      <strong>앨범아트</strong> — {{ RESULT_LABEL[fullRestore.artworkResult.value.outcome] }} ·
      {{ fullRestore.artworkResult.value.detail }}
      <button
        v-if="fullRestore.canRetryArtwork.value"
        type="button"
        class="pill"
        @click="fullRestore.retryArtwork()"
      >
        앨범아트 다시 저장
      </button>
    </p>

    <!-- 데크 그림 (ADR 0045 — 커스텀 테마). -->
    <p
      v-if="fullRestore.deckResult.value !== null"
      class="backup-result artwork-result"
      :class="{ 'is-failed': fullRestore.deckResult.value.outcome !== 'saved' }"
      role="status"
    >
      <strong>데크 그림</strong> — {{ RESULT_LABEL[fullRestore.deckResult.value.outcome] }} ·
      {{ fullRestore.deckResult.value.detail }}
    </p>

    <!--
      화면에는 복원됐지만 저장되지 않은 상태 (M8-4).

      새로고침하면 사라진다. 사용자가 이것을 영구 복원 성공으로 오인하면
      데이터를 잃으므로, **다음 행동**을 함께 둔다.
    -->
    <div
      v-if="restore.unsaved.value"
      class="unsaved-block"
      role="alert"
      aria-label="저장되지 않은 복원"
    >
      <p class="unsaved-text">
        지금 화면은 복원됐지만 <strong>저장되지 않았습니다.</strong> 새로고침하면 되돌아갑니다.
      </p>
      <div class="backup-actions">
        <button
          type="button"
          class="pill pill--strong"
          :disabled="restore.applying.value"
          :aria-busy="restore.applying.value ? 'true' : 'false'"
          @click="restore.retrySave()"
        >
          다시 저장 시도
        </button>
        <button type="button" class="pill" @click="restore.exportCurrentFirst()">
          지금 화면을 JSON으로 내보내기
        </button>
      </div>
    </div>

    <!--
      미리보기. **여기까지 저장소에 아무것도 쓰지 않았다.** 사용자가 아래
      '교체하고 가져오기' 를 눌러야 처음 쓴다.
    -->
    <div
      v-if="restore.preview.value !== null"
      class="preview"
      role="alertdialog"
      aria-label="백업 가져오기 미리보기"
    >
      <h4 class="preview-title">가져오기 미리보기</h4>

      <p v-if="restore.preview.value.exportedAt !== null" class="preview-meta">
        내보낸 시각 {{ restore.preview.value.exportedAt }}
      </p>

      <p v-if="restore.preview.value.blocked !== null" class="preview-blocked">
        {{ restore.preview.value.blocked }}
      </p>

      <!-- 복구본은 온전한 전체 백업이 아니다. 가장 위에서 말한다. -->
      <p v-if="restore.preview.value.recovered !== null" class="preview-warning">
        이 파일은 복구본입니다. 온전한 전체 백업이 아니며 일부 항목이 빠져 있을 수 있습니다.
      </p>

      <table class="preview-table">
        <caption class="preview-caption">
          교체 전후 비교
        </caption>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">지금</th>
            <th scope="col">가져올 것</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">플레이리스트</th>
            <td>{{ restore.preview.value.current.playlists }}개</td>
            <td>
              {{
                restore.preview.value.incoming === null
                  ? '—'
                  : `${restore.preview.value.incoming.playlists}개`
              }}
            </td>
          </tr>
          <tr>
            <th scope="row">트랙</th>
            <td>{{ restore.preview.value.current.tracks }}곡</td>
            <td>
              {{
                restore.preview.value.incoming === null
                  ? '—'
                  : `${restore.preview.value.incoming.tracks}곡`
              }}
            </td>
          </tr>
          <tr>
            <th scope="row">Moments</th>
            <td>{{ restore.preview.value.currentMoments }}개</td>
            <td>
              {{
                restore.preview.value.incomingMoments !== null
                  ? `${restore.preview.value.incomingMoments}개`
                  : restore.preview.value.momentsSection === 'absent'
                    ? '— (파일에 없음)'
                    : '— (읽을 수 없음)'
              }}
            </td>
          </tr>
          <tr>
            <th scope="row">테마</th>
            <td>{{ restore.preview.value.currentTheme }}</td>
            <td>{{ restore.preview.value.incomingTheme ?? '—' }}</td>
          </tr>
          <tr v-if="fullRestore.artworkPreview.value !== null">
            <th scope="row">앨범아트</th>
            <td>이미지 {{ artwork.usage.assets }}개</td>
            <td>
              연결 {{ fullRestore.artworkPreview.value.links }}곡 · 이미지
              {{ fullRestore.artworkPreview.value.images }}개 ({{
                formatBytes(fullRestore.artworkPreview.value.bytes)
              }}<template v-if="fullRestore.artworkPreview.value.existing > 0">
                · 이미 있음 {{ fullRestore.artworkPreview.value.existing }}</template
              >)
            </td>
          </tr>
          <tr v-if="fullRestore.artworkPreview.value?.deckImage">
            <th scope="row">데크 그림</th>
            <td>{{ customTheme.deck === null ? '없음' : '있음' }}</td>
            <td>있음 · 테마와 함께 적용</td>
          </tr>
        </tbody>
      </table>

      <ul class="preview-sections">
        <li v-for="section in restore.preview.value.sections" :key="section.name">
          <strong>{{ section.name }}</strong>
          — {{ section.action === 'replace' ? '교체' : '유지' }} · {{ section.note }}
        </li>
      </ul>

      <ul v-if="restore.preview.value.warnings.length > 0" class="preview-warnings">
        <li v-for="(warning, index) in restore.preview.value.warnings" :key="index">
          {{ describeWarning(warning) }}
        </li>
      </ul>

      <!-- 앨범아트 (ZIP) — 받지 못하는 것 · 저장소 · 원자성 안내. 숨기지 않는다. -->
      <template v-if="fullRestore.artworkPreview.value !== null">
        <p v-if="fullRestore.artworkPreview.value.incompleteAtExport" class="preview-warning">
          이 백업을 만들 때 일부 앨범아트를 넣지 못했다고 적혀 있습니다 — 그 곡은 썸네일로 보입니다.
        </p>
        <ul
          v-if="fullRestore.artworkPreview.value.problems.length > 0"
          class="preview-warnings"
          aria-label="받지 못하는 앨범아트"
        >
          <li v-for="line in fullRestore.artworkPreview.value.problems" :key="line">{{ line }}</li>
        </ul>
        <p v-if="fullRestore.artworkPreview.value.unavailable" class="preview-warning">
          이 브라우저에서 앨범아트 저장소를 열 수 없어 그림은 복원되지 않습니다 (곡 · Moments 만).
        </p>
        <p class="preview-note">
          플레이리스트 · Moments 와 앨범아트는 서로 다른 저장소라 한 번에 되돌릴 수 없습니다. 중간에
          실패하면 일부만 바뀔 수 있으니 먼저 지금 데이터를 전체 백업(ZIP)으로 내려받아 두세요.
        </p>
      </template>

      <label class="preview-toggle">
        <input v-model="restore.applyTheme.value" type="checkbox" />
        테마도 함께 적용
      </label>

      <!--
        무엇이 교체되는지 섹션마다 적는다 (M9-5). 파일에 없는 섹션은 교체되지
        않으므로 여기 나오지 않는다.
      -->
      <div v-if="restore.preview.value.replacing.length > 0" class="preview-danger">
        <p class="preview-danger-head">
          다음이 <strong>교체됩니다.</strong> 되돌릴 수 없으니 먼저 내보내 두세요.
        </p>
        <ul class="preview-danger-list">
          <li v-for="line in restore.preview.value.replacing" :key="line">지금 {{ line }}</li>
        </ul>
      </div>

      <p v-if="restore.preview.value.overwritesProtected" class="preview-warning">
        저장된 원본을 읽지 못한 상태입니다. 가져오면 그 원본을
        <strong>덮어씁니다.</strong>
      </p>

      <p v-if="restore.preview.value.overwritesProtectedMoments" class="preview-warning">
        저장된 Moments 원본을 읽지 못한 상태입니다. 가져오면 그 원본을
        <strong>덮어씁니다.</strong>
      </p>

      <p v-if="restore.stale.value" class="preview-warning">
        미리보기를 뜬 뒤 지금 데이터가 바뀌었습니다. 위 내용을 다시 확인해주세요.
      </p>

      <div class="backup-actions">
        <button
          v-if="fullRestore.active.value"
          type="button"
          class="pill"
          :disabled="full.busy.value"
          @click="full.exportZip()"
        >
          지금 데이터 먼저 전체 백업 (ZIP)
        </button>
        <button type="button" class="pill" @click="restore.exportCurrentFirst()">
          지금 데이터 먼저 내보내기
        </button>
        <button
          v-if="restore.preview.value.overwritesProtected && restore.preview.value.rawAvailable"
          type="button"
          class="pill"
          @click="restore.downloadRawOriginal()"
        >
          읽지 못한 원본 내려받기
        </button>
        <button
          v-if="
            restore.preview.value.overwritesProtectedMoments &&
            restore.preview.value.rawMomentsAvailable
          "
          type="button"
          class="pill"
          @click="restore.downloadRawMoments()"
        >
          읽지 못한 Moments 원본 내려받기
        </button>
      </div>

      <div class="backup-actions">
        <button
          type="button"
          class="pill pill--strong"
          :disabled="restore.preview.value.blocked !== null || restore.applying.value"
          :aria-busy="restore.applying.value ? 'true' : 'false'"
          @click="applyImport"
        >
          교체하고 가져오기
        </button>
        <button type="button" class="pill" @click="cancelImport">취소</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.backup {
  margin-top: 14px;
}

/* 승인된 디자인의 `.pill` 값을 따른다. 터치 목표 44px (M11 U16). */
.pill {
  min-height: 44px;
  padding: 7px 14px;
  border: 1px solid var(--pill-border-color);
  border-radius: var(--radius-control);
  background: var(--pill-surface-color);
  color: var(--pill-text-color);
  font: 11px var(--font-mono);
}

@media (hover: hover) {
  .pill:hover {
    background: var(--pill-surface-hover-color);
  }
}

.pill--strong {
  border-color: var(--accent-strong-color);
  background: var(--accent-strong-color);
  color: var(--accent-strong-text-color);
}

/* 숨긴 파일 입력의 기준 — 단추 줄 안에 둔다. */
.backup-actions {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.backup-warning {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.backup-result,
.full-result {
  margin: 10px 0 0;
  color: var(--row-meta-text-color);
  font: 10px/1.6 var(--font-mono);
}

.backup-result.is-failed,
.full-result.is-failed {
  color: var(--error-text-color);
}

/*
 * 파일 입력을 감춘다. `display: none` 이 아니라 **크기를 0 으로** 둔다 —
 * `display: none` 이면 일부 브라우저에서 프로그래밍 방식 `click()` 이 먹지
 * 않고, 접근성 트리에서도 사라진다.
 */
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 저장되지 않은 복원 안내 (M8-4). 경고 색으로 테두리까지 쓴다. */
.unsaved-block {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.unsaved-text {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.unsaved-text strong {
  font-weight: 600;
}

/* 미리보기. 드로어의 `.confirm` 과 같은 표면을 쓴다. */
.preview {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--row-selected-border-color);
  background: var(--row-selected-surface-color);
}

.preview-title {
  margin: 0 0 10px;
  color: var(--drawer-title-text-color);
  font: 11px var(--font-mono);
  font-weight: 400;
  letter-spacing: 0.08em;
}

.preview-meta {
  margin: 0 0 10px;
  color: var(--row-meta-text-color);
  font: 10px var(--font-mono);
}

.preview-table {
  width: 100%;
  margin-bottom: 10px;
  border-collapse: collapse;
  color: var(--row-text-color);
  font: 11px var(--font-mono);
}

.preview-caption {
  margin-bottom: 6px;
  color: var(--row-meta-text-color);
  font-size: 10px;
  text-align: left;
}

.preview-table th,
.preview-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--rule-color);
  text-align: left;
}

.preview-table thead th {
  color: var(--row-meta-text-color);
  font-weight: 400;
}

.preview-sections,
.preview-warnings {
  margin: 0 0 10px;
  padding-left: 18px;
  color: var(--row-text-color);
  font: 11px/1.6 var(--font-mono);
}

.preview-warnings {
  color: var(--status-warning-text-color);
}

.preview-sections strong {
  font-weight: 500;
}

.preview-toggle {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  color: var(--row-text-color);
  font: 11px var(--font-mono);
  gap: 6px;
}

.preview-danger {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.preview-danger strong,
.preview-warning strong {
  font-weight: 600;
}

/* M9-5: 교체되는 섹션을 한 줄씩. 머리말과 같은 경고 어조다. */
.preview-danger-head {
  margin: 0;
}

.preview-danger-list {
  margin: 4px 0 0;
  padding-left: 16px;
}

/*
 * 섹션별 복원 결과 (M9-5). "저장됨" 만 평소 어조이고, 나머지는 영구 반영이
 * 아니므로 경고 어조다. `kept`(파일에 없어 유지)는 실패가 아니라 평소 어조다.
 */
.result-list {
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--row-meta-text-color);
  font: 10px/1.6 var(--font-mono);
}

.result-list .result--unsaved,
.result-list .result--held,
.result-list .result--skipped {
  color: var(--status-warning-text-color);
}

.result-list strong {
  font-weight: 600;
}

.preview-warning {
  margin: 0 0 10px;
  color: var(--status-warning-text-color);
  font: 11px/1.6 var(--font-mono);
}

.preview-blocked {
  margin: 0 0 10px;
  color: var(--error-text-color);
  font: 11px/1.6 var(--font-mono);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
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
