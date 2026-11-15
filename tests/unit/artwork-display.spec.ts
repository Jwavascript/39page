import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARTWORK_DISPLAY,
  readArtworkDisplay,
  type ArtworkDisplay,
} from '@/shared/types/artwork'
import { readPackedPreference } from '@/features/backup/packageFormat'
import { useArtworkDisplayDrag } from '@/features/artwork/useArtworkDisplayDrag'

describe('Artwork 표시 값·이전 데이터·입력 경계', () => {
  it('v1의 생략 필드는 기본값이며 새 필드는 엄격히 검증한다', () => {
    expect(readArtworkDisplay(undefined)).toEqual(DEFAULT_ARTWORK_DISPLAY)
    expect(readPackedPreference({ mode: 'custom', assetId: 'a'.repeat(64) })).toEqual({
      mode: 'custom',
      assetId: 'a'.repeat(64),
    })
    for (const bad of [
      null,
      {},
      { ...DEFAULT_ARTWORK_DISPLAY, fit: 'stretch' },
      { ...DEFAULT_ARTWORK_DISPLAY, positionX: -1 },
      { ...DEFAULT_ARTWORK_DISPLAY, positionY: 101 },
      { ...DEFAULT_ARTWORK_DISPLAY, zoom: Infinity },
      { ...DEFAULT_ARTWORK_DISPLAY, zoom: NaN },
      { ...DEFAULT_ARTWORK_DISPLAY, zoom: 0.5 },
      { ...DEFAULT_ARTWORK_DISPLAY, zoom: 3.1 },
      { ...DEFAULT_ARTWORK_DISPLAY, zoom: '2' },
    ]) {
      expect(readArtworkDisplay(bad)).toBeNull()
      expect(
        readPackedPreference({ mode: 'custom', assetId: 'a'.repeat(64), display: bad }),
      ).toBeNull()
    }
  })

  it('Cover 가로 이미지 끌기는 실제 넘친 길이를 사용하며 빈 공간을 만들지 않게 끝에서 멈춘다', () => {
    const display = ref<ArtworkDisplay>({ ...DEFAULT_ARTWORK_DISPLAY })
    const drag = useArtworkDisplayDrag(display, ref({ width: 400, height: 200 }))
    const target = document.createElement('div')
    target.getBoundingClientRect = () => ({ width: 160, height: 160 }) as DOMRect
    drag.down({
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      currentTarget: target,
      preventDefault() {},
    } as unknown as PointerEvent)
    drag.move({ pointerId: 1, clientX: 40, clientY: 60 } as PointerEvent)
    expect(display.value.positionX).toBe(25) // 이미지 left -80px → -40px
    expect(display.value.positionY).toBe(50) // 여백이 없는 축은 그대로
    drag.move({ pointerId: 1, clientX: 1000, clientY: 0 } as PointerEvent)
    expect(display.value.positionX).toBe(0)
    drag.end()
    drag.move({ pointerId: 1, clientX: -1000, clientY: 0 } as PointerEvent)
    expect(display.value.positionX).toBe(0)
  })
})
