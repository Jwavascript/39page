<script setup lang="ts">
/**
 * 제품 푸터 (M5).
 *
 * 승인된 디자인의 `.footer` 다. 왼쪽은 **테마 설명**, 오른쪽은 테마와 무관한
 * 제품 문구다.
 *
 * 테마 store 를 여기서 읽는 이유: `DashboardShell` 은 테마를 몰라야 한다.
 * 두 테마가 **같은 셸 인스턴스**를 공유한다는 보장이 그 무지에서 나온다
 * (ADR 0001, `THEME_SYSTEM.md` §5.1). `AppHeader` 가 `ThemeSwitcher` 를
 * 품는 것과 같은 구조다 — 테마를 아는 책임을 잎으로 밀어낸다.
 */
import { useThemeStore } from '@/stores/theme'

/** 테마와 무관한 제품 문구. 승인된 디자인의 오른쪽 문구다. */
const TAGLINE = 'RECORD LIBRARY / PLAYLIST FIRST'

const theme = useThemeStore()
</script>

<template>
  <footer class="app-footer">
    <span class="footer-theme">{{ theme.metadata.footerLabel }}</span>
    <span class="footer-tagline">{{ TAGLINE }}</span>
  </footer>
</template>

<style scoped>
/* 승인된 디자인의 `.footer` 값을 따른다. */
.app-footer {
  display: flex;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--footer-border-color);
  color: var(--footer-text-color);
  font: 10px var(--font-mono);
  justify-content: space-between;
  letter-spacing: 0.05em;
  gap: 15px;
}

/* 승인된 디자인의 650px 규칙. */
@media (max-width: 650px) {
  .app-footer {
    flex-wrap: wrap;
  }
}
</style>
