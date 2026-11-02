/**
 * 테마 상태.
 *
 * 테마의 **단일 진실 공급원**이다. `document.documentElement.dataset.theme`는
 * 이 store의 상태를 따라가는 파생물이며, 반대 방향으로 흐르지 않는다.
 *
 * 이 store는 재생·라이브러리·플레이어를 import하지 않는다. 테마 전환이
 * 재생 상태에 영향을 주지 않는다는 보장을 **구조로** 유지하기 위해서다
 * (`AGENTS.md` 규칙 4, 5 / `docs/architecture/SYSTEM_DESIGN.md` §6).
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  STORAGE_KEYS,
  defineStorage,
  type ReadOutcome,
  type WriteFailureReason,
} from '@/shared/storage'
import { DEFAULT_THEME_KEY, isThemeKey, type ThemeKey } from '@/shared/types'
import { THEMES, THEME_LIST, type ThemeMetadata } from '@/themes'

/**
 * 테마 저장 스키마 버전.
 *
 * 저장 형태는 `{ version, data }`이고 `data`는 테마 키 문자열이다.
 * 아직 이전 버전이 없으므로 `migrate`를 두지 않는다. 버전이 다른 데이터는
 * 저장 계층 정책에 따라 기본값으로 복구되며 **저장소는 변경되지 않는다.**
 */
export const THEME_STORAGE_VERSION = 1

/**
 * 테마 영속화.
 *
 * `validate`가 `isThemeKey`를 그대로 쓰므로 알 수 없는 키는 거부되고
 * `fallback()`의 기본 테마로 복구된다.
 */
export const themeStorage = defineStorage<ThemeKey>({
  key: STORAGE_KEYS.theme,
  version: THEME_STORAGE_VERSION,
  fallback: () => DEFAULT_THEME_KEY,
  validate: (value) => (isThemeKey(value) ? value : null),
})

/** 문서 루트에 테마를 반영한다. CSS는 `[data-theme]`로 토큰을 고른다. */
function applyToDocument(key: ThemeKey): void {
  document.documentElement.dataset.theme = key
}

export const useThemeStore = defineStore('theme', () => {
  const current = ref<ThemeKey>(DEFAULT_THEME_KEY)

  /** 마지막 복원 결과. 저장 데이터 상태를 알려야 할 때 쓴다. */
  const restoreOutcome = ref<ReadOutcome | null>(null)
  /** 마지막 저장 실패 이유. 성공하면 `null`이다. */
  const lastWriteFailure = ref<WriteFailureReason | null>(null)

  const metadata = computed<ThemeMetadata>(() => THEMES[current.value])
  const available = computed<readonly ThemeMetadata[]>(() => THEME_LIST)

  /**
   * DOM을 상태에 맞춘다.
   *
   * `flush: 'sync'`로 두어 상태 변경 직후 DOM이 반영된다. 속성과 상태가
   * 한 틱이라도 어긋나지 않게 하고, 마운트 전 복원에서도 즉시 적용된다.
   */
  watch(current, applyToDocument, { immediate: true, flush: 'sync' })

  /**
   * 저장된 테마를 복원한다.
   *
   * **읽기만 한다.** 손상된 데이터나 미래 버전 데이터를 덮어쓰거나 지우지
   * 않는다 (`docs/architecture/SYSTEM_DESIGN.md` §7.1).
   */
  function restore(): ReadOutcome {
    const { value, outcome } = themeStorage.read()
    restoreOutcome.value = outcome
    current.value = value
    return outcome
  }

  /**
   * 테마를 바꾸고 저장을 시도한다.
   *
   * 전환은 저장 성공 여부와 **무관하게** 먼저 적용된다. 저장소를 쓸 수 없는
   * 환경에서도 이번 세션의 전환은 동작해야 한다.
   *
   * @returns 저장에 성공했는지. 전환 자체는 항상 적용된다.
   */
  function setTheme(key: ThemeKey): boolean {
    // 런타임에서 들어온 값(저장 데이터, DOM 속성 등)에 대한 방어.
    const next: ThemeKey = isThemeKey(key) ? key : DEFAULT_THEME_KEY

    current.value = next

    const result = themeStorage.write(next)
    lastWriteFailure.value = result.ok ? null : result.reason
    return result.ok
  }

  return {
    current,
    metadata,
    available,
    restoreOutcome,
    lastWriteFailure,
    restore,
    setTheme,
  }
})
