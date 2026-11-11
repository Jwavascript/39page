<script setup lang="ts">
/**
 * 단축키 한 줄 (M10-5). 지정돼 있으면 키를, 아니면 "지정되지 않음" 을 적는다. 표현만 맡는다.
 * 아직 읽기 전(`undefined`)이면 아무것도 그리지 않는다.
 */
defineProps<{ shortcut: string | undefined }>()
</script>

<template>
  <p v-if="shortcut !== undefined" class="shortcut">
    <template v-if="shortcut !== ''">
      단축키 <kbd class="key">{{ shortcut }}</kbd>
    </template>
    <template v-else>단축키 지정되지 않음</template>
  </p>
</template>

<style scoped>
.shortcut {
  margin: 0;
  color: var(--text-dim-color);
  font-size: 11px;
}

.key {
  padding: 1px 5px;
  border: 1px solid var(--pill-border-color);
  border-radius: 4px;
  color: var(--text-muted-color);
  font: 11px var(--font-mono);
}
</style>
