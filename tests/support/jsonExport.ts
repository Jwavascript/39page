/**
 * JSON 백업 내보내기(`useBackupExport`)를 화면 단추 없이 부른다.
 *
 * ADR 0043 에서 데이터 대화상자의 "JSON 백업 내보내기" 단추를 없앴다 — 화면에는 저장된 데이터를 읽지 못했을 때의
 * "복구본 내보내기" 로만 남는다. 내보내기 자체(파일 내용 · 불변성 · 결과 안내)는 그대로라, 시험은 같은 composable 을 이
 * 작은 부품으로 직접 부른다. 지금 활성 pinia 를 쓴다 — 앱과 같은 store 를 본다.
 */
import { defineComponent } from 'vue'

import { mount } from '@vue/test-utils'

import { useBackupExport } from '@/features/backup/useBackupExport'

export type JsonExporter = ReturnType<typeof useBackupExport>

export function jsonExporter(): JsonExporter {
  let api: JsonExporter | null = null
  mount(
    defineComponent({
      setup() {
        api = useBackupExport()
        return () => null
      },
    }),
  )
  if (api === null) throw new Error('useBackupExport did not run')
  return api
}
