/**
 * M12-4 시험 도구 — "브라우저 프로필" 하나를 흉내 내고, 그 안에서 composable 을 쓴다.
 *
 * - 프로필 = 비운 localStorage + 새 Pinia + 새 IndexedDB(fake-indexeddb). 두 프로필을 차례로 만들면 "다른 컴퓨터" 다
 * - jsdom 의 Blob 은 구조적 복제를 지나면 Blob 이 아니게 된다(브라우저는 그대로) — Node 의 Blob · File 로 바꿔 끼운다
 * - 내려받기는 `URL.createObjectURL` 을 가로채 바이트를 잡는다
 */
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

import { defineComponent } from 'vue'

import { mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'

import { ARTWORK_IMAGE_TOOLS } from '@/features/artwork/imageValidation'
import { useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'

import { fakeImageTools } from './artworkFixtures'

export function useNodeBlobs(): void {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
}

/** 내려받기를 가로챈다 — 마지막으로 내려받은 바이트 · 이름. */
export function captureDownloads() {
  const captured: { blob: Blob; name: string }[] = []
  const original = HTMLAnchorElement.prototype.click
  let lastBlob: Blob | null = null
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      lastBlob = blob
      return 'blob:capture'
    },
    revokeObjectURL: () => {},
  })
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (lastBlob !== null) captured.push({ blob: lastBlob, name: this.download })
  }
  return {
    captured,
    async lastBytes(): Promise<Uint8Array> {
      const last = captured[captured.length - 1]
      if (last === undefined) throw new Error('nothing downloaded')
      return new Uint8Array(await last.blob.arrayBuffer())
    },
    restore() {
      HTMLAnchorElement.prototype.click = original
    },
  }
}

export interface Profile {
  readonly factory: IDBFactory
}

/** 새 프로필 — 저장소 · Pinia · IndexedDB 가 모두 비어 있다. */
export async function newProfile(options: { artwork?: 'ok' | 'broken' } = {}): Promise<Profile> {
  globalThis.localStorage.clear()
  setActivePinia(createPinia())
  const factory = new IDBFactory()
  useLibraryStore().restore()
  useMomentsStore().restore()
  await useArtworkStore().init({
    factory:
      options.artwork === 'broken'
        ? ({
            open: () => {
              throw new DOMException('blocked', 'SecurityError')
            },
          } as unknown as IDBFactory)
        : factory,
    channel: null,
  })
  return { factory }
}

/** composable 을 컴포넌트 setup 안에서 부른다 (inject 가 필요하다). */
export function inSetup<T>(run: () => T): T {
  let result: T | undefined
  mount(
    defineComponent({
      setup() {
        result = run()
        return () => null
      },
    }),
    { global: { provide: { [ARTWORK_IMAGE_TOOLS as symbol]: fakeImageTools() } } },
  )
  return result as T
}
